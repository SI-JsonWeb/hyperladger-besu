# Besu Redis Presentation Guide

## Audience

Technical audience: backend engineers, blockchain engineers, platform engineers, and developers who understand APIs, databases, event streams, and basic Ethereum/Besu concepts.

## Core Message

`besu-redis-indexer` is a read-only indexing service that copies public Besu blockchain data into Redis 8 so developers can search and monitor blockchain activity quickly.

Besu remains the source of truth. Redis is a fast, rebuildable read model.

## One-Slide Summary

```text
Hyperledger Besu
  public blocks, transactions, contract logs
        |
        v
besu-redis-indexer
  catch-up + live polling/subscription
        |
        v
Redis 8
  HASH documents
  Redis Search indexes
  Redis Streams
  progress dashboard
```

Key point: the indexer converts blockchain data into query-friendly Redis structures.

## Why This Exists

Reading directly from a blockchain node is reliable, but not always ergonomic for application search or operational dashboards.

Typical blockchain reads answer questions like:

- What is the current block?
- What happened in this transaction?
- What logs exist for this contract?

Application and operations teams often want questions like:

- Which asset was financed twice?
- Which borrower or lender appears in events?
- Which fraud events happened recently?
- How far behind is the indexer?
- Can I search by file hash, file URI, account, asset ID, or event name?

Redis gives us fast search, simple key-value inspection, and live progress visibility.

## Architecture

The service has five main parts:

| Layer | Code | Responsibility |
|---|---|---|
| Entrypoint | `src/main.ts` | Startup, retry, schema init, dashboard, catch-up, polling |
| Besu reader | `src/besu/reader.ts` | Read blocks, receipts, logs using ethers |
| Indexer | `src/indexer/catchup.ts` | Decide which blocks to process and write progress |
| Contract decoder | `src/contracts/double-financing.ts` | Decode DoubleFinancingPreventer events |
| Redis layer | `src/redis/*` | Redis connection, schemas, document writes, streams, dashboard |

## Runtime Flow

Startup flow:

1. Load config from environment and deployment file.
2. Connect to Redis.
3. Validate Redis 8 and Redis Search support.
4. Create Redis Search indexes.
5. Start dashboard on port `8090`.
6. Connect to Besu HTTP RPC.
7. Read cursor from Redis.
8. Catch up from cursor to current Besu head.
9. Start WebSocket block subscription if available.
10. Start HTTP polling fallback.

Block processing flow:

1. Read block with transactions from Besu.
2. Write block document to Redis.
3. Write transaction documents to Redis.
4. Read contract logs for that block.
5. Decode DoubleFinancingPreventer events.
6. Write event documents to Redis.
7. Emit Redis Stream notifications.
8. Update cursor only after writes succeed.
9. Update dashboard progress state.

## Redis Data Model

The indexer writes deterministic Redis HASH keys:

| Data | Key Pattern |
|---|---|
| Block | `besu:block:{chainId}:{blockNumber}` |
| Transaction | `besu:tx:{chainId}:{txHash}` |
| Contract event | `dfp:event:{chainId}:{blockNumber}:{txIndex}:{logIndex}` |
| Cursor | `indexer:{chainId}:cursor` |
| Head | `indexer:{chainId}:head` |
| Stats | `indexer:{chainId}:stats` |
| Recent progress | `indexer:{chainId}:recent` |

Deterministic keys matter because restarting or re-indexing does not create duplicate documents.

## Redis Search Indexes

The service creates three Redis Search indexes:

| Index | Source Key Prefix | Search Purpose |
|---|---|---|
| `idx:besu_blocks` | `besu:block:{chainId}:` | Search block number, hash, timestamp |
| `idx:besu_txs` | `besu:tx:{chainId}:` | Search tx hash, sender, receiver, status |
| `idx:dfp_events` | `dfp:event:{chainId}:` | Search contract events and business fields |

Important distinction:

`Indexed block` means the indexer has processed that block and written Redis HASH documents.

Redis Search then indexes those HASH fields so `/api/search` and `FT.SEARCH` can query them.

Our code does not manually build the inverted index. Redis Search handles that after schemas are created.

## Search Examples

Example Redis CLI queries:

```bash
FT.SEARCH idx:besu_blocks '@number:[100 100]'
FT.SEARCH idx:besu_txs '@from:{0xabc...}'
FT.SEARCH idx:dfp_events '@eventName:{FraudAttemptDetected}'
FT.SEARCH idx:dfp_events '@assetId:{1}'
FT.SEARCH idx:dfp_events '@fileURI:ipfs*'
```

Dashboard search uses `/api/search`:

```text
/api/search?index=events&q=FraudAttemptDetected
/api/search?index=events&q=assetId:1
/api/search?index=blocks&q=100
/api/search?index=txs&q=0x...
```

## Redis Streams

Streams are used as lightweight notifications:

| Stream | Meaning |
|---|---|
| `stream:besu:{chainId}:blocks` | A block document was written |
| `stream:besu:{chainId}:txs` | A transaction document was written |
| `stream:dfp:{chainId}:events` | A contract event document was written |
| `stream:dfp:{chainId}:removals` | A removed event was handled |

Streams are not the primary data store. The HASH documents are the searchable read model.

## Dashboard Metrics

The dashboard exposes operational state:

| Metric | Meaning |
|---|---|
| Head block | Latest block known from Besu |
| Indexed block | Last block fully processed into Redis |
| Lag | `Head block - Indexed block` |
| Blocks indexed | Count of blocks processed by this progress tracker |
| Transactions | Count of transactions written during tracked progress |
| Events | Count of decoded contract events written |
| Fraud detected | Count of fraud-related events |

Important explanation:

`Indexed block` is a position.

`Blocks indexed` is a counter.

They can differ. If indexing starts at block `900` and reaches block `1000`, then `Indexed block` is `1000`, but `Blocks indexed` is about `101`.

## Live Updates

The dashboard uses:

- `/api/snapshot` for initial state.
- `/api/progress` for Server-Sent Events.
- Redis Pub/Sub channel `indexer:progress` behind the SSE endpoint.

Each processed block publishes a progress payload. The browser updates stats and recent activity without reloading.

## Reliability Model

The reliability model is simple and intentional:

- Besu is authoritative.
- Redis is rebuildable.
- Cursor updates after successful Redis writes.
- Deterministic keys avoid duplicate documents.
- WebSocket subscription is only a trigger.
- HTTP catch-up remains the durable path.
- HTTP polling acts as fallback if WebSocket fails.

This means the indexer can recover by reading the cursor and continuing from the next block.

## Reorg / Removed Log Handling

The event decoder preserves `removed` log state.

When a removed event is detected:

1. Delete the old event HASH.
2. Publish a removal stream entry.

This avoids stale event data staying searchable in Redis.

## Current Scope

The indexer currently handles:

- Public Besu blocks.
- Public transactions.
- Public logs from the configured DoubleFinancingPreventer contract.
- Redis Search over indexed HASH documents.
- Dashboard, search, progress, and Redis health info.

It does not index:

- Private Tessera payloads.
- Every contract on the chain.
- Arbitrary historical ABI decoding.
- A separate REST API for application business logic.

## Recent Changes To Mention

Recent work added three visible capabilities:

1. Progress dashboard.
   Shows head, cursor, lag, stats, recent activity, indexes, streams, and Redis health.

2. Redis full-text/search dashboard.
   Adds browser search over blocks, transactions, and DFP events.

3. Frontend workflow improvements.
   The main Double Financing frontend was improved, while `besu-redis-indexer` remains the Redis/Besu observability and search service.

## Demo Script

Recommended live demo flow:

1. Start Besu, backend, Redis, and the indexer.
2. Open the indexer dashboard at `http://127.0.0.1:8090`.
3. Show `Head block`, `Indexed block`, and `Lag`.
4. Trigger a transaction in the Double Financing frontend.
5. Watch `Indexed block`, transaction count, event count, or fraud count update.
6. Search for:
   - `FraudAttemptDetected`
   - `AssetRegistered`
   - `assetId:1`
   - a transaction hash
7. Show matching Redis command displayed by the dashboard.
8. Open Redis CLI and run one matching `FT.SEARCH` command.
9. Explain that Redis can be deleted and rebuilt from Besu.

## Suggested Slide Outline

1. Problem: blockchain data is hard to search operationally.
2. Solution: Besu Redis Indexer as a read-only projection.
3. Architecture diagram.
4. Runtime flow.
5. Redis data model.
6. Redis Search indexes.
7. Streams and progress events.
8. Dashboard metrics.
9. Reliability and recovery model.
10. Demo.
11. Limitations and next steps.

## Good Technical Talking Points

- The cursor is the boundary between processed and unprocessed blocks.
- Search indexes are created once, then Redis indexes matching HASH keys.
- Streams are notifications, not the source of truth.
- Redis stores query-friendly copies of blockchain facts.
- Besu remains authoritative for correctness.
- The system favors rebuildability over complex distributed coordination.
- The dashboard is useful both for demos and operational debugging.

## Potential Questions And Answers

### Is Redis replacing Besu?

No. Redis is a cache/read model. Besu remains the source of truth.

### What happens if Redis is deleted?

The indexer can rebuild by reading Besu again from genesis or the configured contract start block.

### Why use Redis HASH documents?

Redis Search indexes HASH fields directly. HASH documents also make manual inspection with `HGETALL` easy.

### Why use Redis Streams?

Streams let downstream consumers react to new indexed documents without embedding the full block, transaction, or event payload in every message.

### Why both WebSocket and polling?

WebSocket gives fast triggers when new blocks arrive. Polling keeps the system moving if WebSocket is unavailable.

### What does lag mean?

Lag is the difference between the latest Besu block and the latest block fully indexed into Redis.

### Is search eventually consistent?

Yes. A block must first be processed and written into Redis. Then Redis Search can query the HASH fields.

## Next Improvements

Possible future improvements:

- Apply configurable block confirmations before indexing final data.
- Add automated tests for dashboard progress updates.
- Add Docker Compose services for Redis and the indexer if not already wired in the target environment.
- Add consumer examples for Redis Streams.
- Add index rebuild commands or admin scripts.
- Add metrics export for Prometheus or OpenTelemetry.
