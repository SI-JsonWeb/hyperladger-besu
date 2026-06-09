# Besu Redis 8 Indexer

Read-only daemon that indexes public Besu blocks/transactions and DoubleFinancingPreventer events into Redis 8.

## Quick Start

### Local (requires Redis 8 running)
```bash
cd besu-redis-indexer
npm install
npm run build
# Start Redis 8 on localhost:6379 first, then:
node dist/main.js
```

### Docker Compose
```bash
cd quorum-test-network
docker compose up -d redis besu-redis-indexer
docker compose logs -f besu-redis-indexer
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| RPC_HTTP_URL | http://127.0.0.1:8545 | Besu HTTP RPC |
| RPC_WS_URL | ws://127.0.0.1:8546 | Besu WebSocket RPC |
| REDIS_URL | redis://127.0.0.1:6379 | Redis connection URL |
| CHAIN_ID | 1337 | Chain identifier |
| CONTRACT_ADDRESS | (from deployment.json) | DoubleFinancingPreventer address |
| CONTRACT_START_BLOCK | (from deployment.json) | Block when contract was deployed |
| INDEX_BLOCKS_FROM_GENESIS | true | Index from block 0 or from CONTRACT_START_BLOCK |
| REDIS_INFO_HOST | 0.0.0.0 | Host for the Redis information HTML site |
| REDIS_INFO_PORT | 8090 | Port for the Redis information HTML site |

## CLI Flags

- `--print-config`: Print configuration and exit (no connections)
- `--init-schema-only`: Initialize Redis indexes and exit

## Redis Data Model

## Redis Information Site

The indexer serves a small HTML dashboard after Redis schema initialization:

- `http://127.0.0.1:8090/` — browser dashboard with Redis health, document counts, stream lengths, and cursor state
- `http://127.0.0.1:8090/api/redis` — same information as JSON

Set `REDIS_INFO_HOST` and `REDIS_INFO_PORT` to change the bind address.

## Redis Data Model

### HASH Documents

| Key Pattern | Description |
|---|---|
| `besu:block:{chainId}:{blockNumber}` | Block header + tx count |
| `besu:tx:{chainId}:{txHash}` | Transaction data |
| `dfp:event:{chainId}:{blockNumber}:{txIndex}:{logIndex}` | Contract event |

### Redis Search Indexes

- `idx:besu_blocks` — over `besu:block:` keys
- `idx:besu_txs` — over `besu:tx:` keys
- `idx:dfp_events` — over `dfp:event:` keys

### Redis Streams (at-least-once notifications)

- `stream:besu:{chainId}:blocks`
- `stream:besu:{chainId}:txs`
- `stream:dfp:{chainId}:events`

### Cursor

- Key: `indexer:{chainId}:cursor` (HASH with lastBlockNumber, lastBlockHash, updatedAt)

## Verification Commands

```bash
# Check Redis version
docker compose exec redis redis-cli INFO server | grep redis_version

# Check FT indexes exist
docker compose exec redis redis-cli FT._LIST

# Search for fraud events
docker compose exec redis redis-cli FT.SEARCH idx:dfp_events '@eventName:{FraudAttemptDetected}'

# Search for file events
docker compose exec redis redis-cli FT.SEARCH idx:dfp_events '@eventName:{FileRegistered} @fileURI:ipfs'

# Check block indexing
docker compose exec redis redis-cli FT.SEARCH idx:besu_blocks '*' LIMIT 0 1

# Check cursor
docker compose exec redis redis-cli HGETALL indexer:1337:cursor
```

## Architecture

- WS subscription only triggers HTTP catch-up (WS is non-durable)
- Cursor updates after all Redis writes succeed per block
- Deterministic HASH keys prevent duplication on restart
- Streams are at-least-once notifications, not source of truth

## Scope Notes

- Public blocks/transactions only — private Tessera/member data is NOT indexed
- Redis is a searchable cache — Besu remains authoritative
- No REST API is provided
