# How the Besu Redis Indexer Works

This document explains the `besu-redis-indexer` code for beginners.

## What This Program Does

The indexer is a small background program. It watches a local Hyperledger Besu blockchain and copies useful public blockchain data into Redis 8.

It stores three kinds of data:

- Blocks
- Transactions
- `DoubleFinancingPreventer` smart contract events

Redis is used as a fast searchable cache. Besu is still the real source of truth.

## Big Picture

The program follows this flow:

```text
Besu blockchain
      |
      | HTTP reads blocks, transactions, and logs
      v
besu-redis-indexer
      |
      | HSET + XADD
      v
Redis 8
```

The indexer does not send transactions and does not need a private key. It only reads blockchain data.

## Important Files

| File | Purpose |
|---|---|
| `src/main.ts` | Starts the program and connects all pieces together |
| `src/config.ts` | Loads configuration such as RPC URLs and Redis URL |
| `src/artifacts.ts` | Loads the smart contract ABI and checks required events exist |
| `src/besu/reader.ts` | Reads blocks, receipts, and logs from Besu |
| `src/indexer/catchup.ts` | Decides which blocks need indexing and processes them |
| `src/contracts/double-financing.ts` | Decodes smart contract event logs |
| `src/redis/client.ts` | Connects to Redis and verifies Redis 8 + Search support |
| `src/redis/schema.ts` | Creates Redis Search indexes |
| `src/redis/writer.ts` | Writes blocks, transactions, events, streams, and cursor data |

## Startup: `main.ts`

`src/main.ts` is the entry point.

When you run:

```bash
node dist/main.js
```

the program does this:

1. Loads config.
2. Connects to Redis.
3. Checks Redis is version 8.
4. Creates Redis Search indexes.
5. Connects to Besu HTTP RPC.
6. Runs an initial catch-up from the last saved block.
7. Starts a WebSocket listener.
8. Starts periodic HTTP polling.
9. Waits until the process is stopped.

It also supports two helper flags:

```bash
node dist/main.js --print-config
```

Prints config and exits without connecting to Redis or Besu.

```bash
node dist/main.js --init-schema-only
```

Connects to Redis, creates indexes, then exits.

## Configuration: `config.ts`

`src/config.ts` collects settings from environment variables and deployment files.

Examples:

- `RPC_HTTP_URL` tells the indexer where Besu HTTP RPC is.
- `RPC_WS_URL` tells it where Besu WebSocket RPC is.
- `REDIS_URL` tells it where Redis is.
- `CHAIN_ID` identifies the chain.
- `CONTRACT_ADDRESS` identifies the deployed `DoubleFinancingPreventer` contract.

If some values are not provided as environment variables, the code tries to read them from:

```text
../smart_contracts/deployments/deployment.json
```

## Reading From Besu: `reader.ts`

`src/besu/reader.ts` contains simple helper functions for Besu.

It can:

- Create an HTTP provider.
- Create a WebSocket provider.
- Read a block and its transactions.
- Read a transaction receipt.
- Read contract logs from a block range.

The HTTP provider is used for correctness. The WebSocket provider is only used as a wake-up signal.

## Catch-Up Logic: `catchup.ts`

The most important logic is in `src/indexer/catchup.ts`.

The indexer must know which blocks have already been processed. It stores this progress in Redis as a cursor:

```text
indexer:{chainId}:cursor
```

The cursor stores:

- `lastBlockNumber`
- `lastBlockHash`
- `updatedAt`

When catch-up starts, the code checks the cursor.

If a cursor exists, it starts at:

```text
lastBlockNumber + 1
```

If no cursor exists, it starts from block `0` when `INDEX_BLOCKS_FROM_GENESIS=true`.

For every block, the indexer:

1. Reads the block.
2. Writes a block document to Redis.
3. Writes a block stream notification.
4. Reads every transaction receipt.
5. Writes transaction documents to Redis.
6. Writes transaction stream notifications.
7. Reads smart contract logs for that block.
8. Decodes contract events.
9. Writes event documents to Redis.
10. Writes event stream notifications.
11. Updates the cursor after the whole block succeeds.

Updating the cursor last is important. If the program crashes in the middle of a block, it can retry safely later.

## Why WebSocket Is Not Enough

WebSocket notifications can be missed if the program is offline.

So the code does not trust WebSocket as the main source of correctness.

Instead:

- WebSocket says: "A new block probably exists."
- HTTP catch-up says: "Let me check exactly which blocks are missing."

This is safer because the cursor decides what still needs to be indexed.

## Decoding Contract Events: `double-financing.ts`

Besu returns smart contract events as raw logs. Raw logs are hard to read.

`src/contracts/double-financing.ts` uses the contract ABI to turn those logs into meaningful event objects.

It supports these events:

- `AssetRegistered`
- `FinancingRecorded`
- `LienReleased`
- `FraudAttemptDetected`
- `AccountFlagged`
- `FileRegistered`

For example, when someone tries to finance an already pledged asset, the contract emits fraud-related events. The transaction does not revert. The indexer detects fraud by indexing those events.

## Handling Removed Logs

Blockchain nodes may mark logs as `removed` during a chain reorganization.

The indexer handles that by:

1. Detecting `removed: true` in the event log.
2. Deleting the old Redis event document.
3. Writing a removal notification to:

```text
stream:dfp:{chainId}:removals
```

This prevents stale event data from staying in Redis.

## Writing To Redis: `writer.ts`

`src/redis/writer.ts` writes data to Redis using deterministic keys.

Deterministic means the same blockchain item always gets the same Redis key.

Examples:

```text
besu:block:{chainId}:{blockNumber}
besu:tx:{chainId}:{txHash}
dfp:event:{chainId}:{blockNumber}:{txIndex}:{logIndex}
```

Because the keys are deterministic, rerunning the indexer overwrites the same documents instead of creating duplicates.

`writer.ts` is the part of the program that turns indexed blockchain data into the Redis data model. It has two main jobs:

1. Store the latest searchable data as Redis HASH documents.
2. Publish small Redis Stream messages so other services can react to new data.

The important distinction is:

```text
HASH document = the data you search and read later
Stream message = the notification that something was written
```

For example, when a block is indexed, the writer first stores this HASH:

```text
besu:block:{chainId}:{blockNumber}
```

Then it writes a message to this stream:

```text
stream:besu:{chainId}:blocks
```

The stream message does not contain the full block. It contains a `docKey` that points back to the HASH document. This keeps stream messages small and makes the HASH document the single Redis copy of the searchable data.

### Why `HSET` Is Used

`HSET` writes fields into a Redis HASH.

The indexer uses HASH documents because Redis Search indexes HASH fields. That means fields like `blockNumber`, `txHash`, `eventName`, `assetId`, `borrower`, or `fileURI` can be searched later with `FT.SEARCH`.

Examples from `writer.ts`:

```text
writeBlockDoc  -> HSET besu:block:{chainId}:{blockNumber}
writeTxDoc     -> HSET besu:tx:{chainId}:{txHash}
writeEventDoc  -> HSET dfp:event:{chainId}:{blockNumber}:{txIndex}:{logIndex}
writeCursor    -> HSET indexer:{chainId}:cursor
```

`HSET` is a good fit here because:

- Each document has named fields.
- The same key can be safely written again.
- Re-indexing a block updates the same Redis document instead of creating duplicates.
- Redis Search can index the HASH fields.
- Consumers can fetch the full document later with `HGETALL` using the `docKey` from a stream message.

This is why blocks, transactions, events, and the cursor are stored with `HSET` instead of `SET`. A plain string value would be harder to search by individual fields.

### Why `XADD` Is Used

`XADD` appends a message to a Redis Stream.

The indexer uses streams when something has happened and another program may want to react.

Examples from `writer.ts`:

```text
addBlockStream   -> XADD stream:besu:{chainId}:blocks
addTxStream      -> XADD stream:besu:{chainId}:txs
addEventStream   -> XADD stream:dfp:{chainId}:events
addRemovalStream -> XADD stream:dfp:{chainId}:removals
```

`XADD` is a good fit here because:

- It appends messages in order.
- Consumers can remember the last stream ID they processed.
- More than one consumer can read the same stream.
- The message can be small because it only needs fields like `docKey`, `chainId`, `blockNumber`, `txHash`, or `eventName`.

The stream is not the source of truth. If a consumer receives a stream message, it should use `docKey` to read the HASH document when it needs full details.

## Redis Search Indexes

`src/redis/schema.ts` creates three Redis Search indexes:

```text
idx:besu_blocks
idx:besu_txs
idx:dfp_events
```

These indexes make it possible to search data quickly.

Example fraud search:

```bash
docker compose exec redis redis-cli FT.SEARCH idx:dfp_events '@eventName:{FraudAttemptDetected}'
```

## Redis Streams

The indexer also writes stream notifications.

Streams are useful when another program wants to react to new indexed data.

The streams are:

```text
stream:besu:{chainId}:blocks
stream:besu:{chainId}:txs
stream:dfp:{chainId}:events
stream:dfp:{chainId}:removals
```

Streams are notifications only. The main searchable data is stored in Redis HASH documents.

### How the Streams Relate To Each Other

The streams follow the same order as blockchain indexing:

```text
block indexed
  -> stream:besu:{chainId}:blocks

transactions in that block indexed
  -> stream:besu:{chainId}:txs

DoubleFinancingPreventer logs in that block decoded and indexed
  -> stream:dfp:{chainId}:events

removed DoubleFinancingPreventer logs detected
  -> stream:dfp:{chainId}:removals
```

They are related by blockchain position, not by Redis Stream IDs.

For example, a block stream message may say block `15` was indexed. Transaction stream messages may then point to transactions from block `15`. Event stream messages may point to contract events emitted by transactions in block `15`.

The HASH documents contain the fields that connect them:

| Data | Redis key | Relationship fields |
|---|---|---|
| Block | `besu:block:{chainId}:{blockNumber}` | `number`, `hash` |
| Transaction | `besu:tx:{chainId}:{txHash}` | `blockNumber`, `blockHash`, `txIndex` |
| Event | `dfp:event:{chainId}:{blockNumber}:{txIndex}:{logIndex}` | `blockNumber`, `blockHash`, `txHash`, `txIndex`, `logIndex` |
| Removal | stream message only | `docKey`, `eventName`, `removed: true` |

This means a consumer can connect the data like this:

1. Read a block notification from `stream:besu:{chainId}:blocks`.
2. Use the block number or block hash to search transactions in `idx:besu_txs`.
3. Use the same block number, block hash, transaction hash, or transaction index to search related contract events in `idx:dfp_events`.

The event stream is separate from the transaction stream because not every transaction emits a `DoubleFinancingPreventer` event. A normal transfer or unrelated contract call may appear in the transaction stream but never appear in the DFP event stream.

The removal stream is separate from the event stream because it means the opposite thing. `stream:dfp:{chainId}:events` says: "this event document now exists." `stream:dfp:{chainId}:removals` says: "this old event document was removed because the blockchain node marked the log as removed."

### Example Stream Message Flow

Imagine block `20` contains two transactions:

- Transaction `0` registers an asset and emits `AssetRegistered`.
- Transaction `1` records financing and emits `FinancingRecorded`.

The indexer writes:

```text
HSET besu:block:1337:20
XADD stream:besu:1337:blocks docKey=besu:block:1337:20 blockNumber=20

HSET besu:tx:1337:{txHash0}
XADD stream:besu:1337:txs docKey=besu:tx:1337:{txHash0} txHash={txHash0}

HSET besu:tx:1337:{txHash1}
XADD stream:besu:1337:txs docKey=besu:tx:1337:{txHash1} txHash={txHash1}

HSET dfp:event:1337:20:0:{logIndex0}
XADD stream:dfp:1337:events docKey=dfp:event:1337:20:0:{logIndex0} eventName=AssetRegistered

HSET dfp:event:1337:20:1:{logIndex1}
XADD stream:dfp:1337:events docKey=dfp:event:1337:20:1:{logIndex1} eventName=FinancingRecorded
```

If Besu later reports that one of those logs was removed, the indexer writes:

```text
DEL dfp:event:1337:20:1:{logIndex1}
XADD stream:dfp:1337:removals docKey=dfp:event:1337:20:1:{logIndex1} eventName=FinancingRecorded removed=true
```

So consumers should treat stream messages as work notifications, then read or search HASH documents for current state.

## Why Redis Is Only a Cache

Redis is fast, but it is not the blockchain.

If Redis is deleted, the indexer can rebuild the data by reading Besu again.

That is why Besu remains the source of truth, and Redis is only a searchable copy.

## Simple Mental Model

Think of the indexer like a librarian.

- Besu is a huge book of blockchain history.
- The indexer reads pages from the book.
- Redis is a card catalog that makes the book easy to search.
- The cursor is the bookmark showing where the librarian stopped reading.

If the librarian restarts, it looks at the bookmark and continues from there.

## Common Commands

Build the indexer:

```bash
cd quorum-test-network/besu-redis-indexer
npm run build
```

Print configuration:

```bash
node dist/main.js --print-config
```

Start Redis and the indexer with Docker Compose:

```bash
cd quorum-test-network
docker compose up -d redis besu-redis-indexer
```

Check Redis indexes:

```bash
docker compose exec redis redis-cli FT._LIST
```

Search fraud events:

```bash
docker compose exec redis redis-cli FT.SEARCH idx:dfp_events '@eventName:{FraudAttemptDetected}'
```
