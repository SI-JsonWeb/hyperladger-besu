# Real-Time Progress Dashboard — Design Proposal

## Overview

Add a live progress dashboard to the `info-server.ts` that shows what the indexer is processing in real time without page refresh.

---

## Redis Data Model

All keys live under `indexer:{chainId}:*`.

### `indexer:{chainId}:head`
Tracks the latest block observed on the Besu network (not yet fully processed).

| Field | Type | Description |
|---|---|---|
| `blockNumber` | string | Latest block number the indexer has seen from Besu |
| `timestamp` | string | ISO timestamp of last update |

Updated once per `runCatchUp()` call, before processing begins.

### `indexer:{chainId}:stats`
Rolling counters for throughput.

| Field | Type | Description |
|---|---|---|
| `blocksIndexed` | string | Total blocks indexed (all time) |
| `txsIndexed` | string | Total transactions indexed (all time) |
| `eventsIndexed` | string | Total events indexed (all time) |
| `fraudDetected` | string | Total fraud events (`FraudAttemptDetected` + `AccountFlagged`) |
| `lastBlockAt` | string | ISO timestamp of last fully processed block |

### `indexer:{chainId}:recent`
A Redis LIST used as a circular buffer of recent items.

- `LPUSH` after each processed block with a JSON payload
- `LTRIM 0 49` to keep last 50 items

Payload shape:
```json
{
  "type": "block",
  "blockNumber": 12345,
  "txCount": 5,
  "eventCount": 2,
  "events": ["FinancingRecorded", "AssetRegistered"],
  "isFraud": false,
  "ts": "2026-06-09T12:00:00.000Z"
}
```

For fraud events, `isFraud: true` and `eventNames` contains fraud types.

### Redis Pub/Sub Channel: `indexer:progress`

One channel. One message per processed block.

Payload:
```json
{
  "blockNumber": 12345,
  "txCount": 5,
  "eventNames": ["AssetRegistered"],
  "isFraud": false,
  "ts": "2026-06-09T12:00:00.000Z"
}
```

Pub/sub is **not durable** — if the subscriber is down during a publish, that message is lost. This is acceptable.

---

## SSE Endpoint

```
GET /api/progress  →  text/event-stream
```

No query parameters. Clients open the stream once and receive push updates.

Each SSE event:
```
data: {"blockNumber":12345,"txCount":5,"eventNames":["FinancingRecorded"],"isFraud":false,"ts":"..."}

```

When a fraud event is detected, `isFraud: true` so the UI can apply visual highlighting.

---

## Catchup Changes (`catchup.ts`)

After `processBlock()` completes, before returning:

```typescript
// 1. Update head
await client.hSet(key('head'), { blockNumber: String(block.number), timestamp: new Date().toISOString() });

// 2. Update stats
await client.hIncrBy(key('stats'), 'blocksIndexed', 1);
await client.hIncrBy(key('stats'), 'txsIndexed', block.transactions.length);
await client.hIncrBy(key('stats'), 'lastBlockAt', new Date().toISOString());
// increment eventsIndexed and fraudDetected from parsed events...

// 3. Push to recent list
await client.lPush(key('recent'), JSON.stringify(recentPayload));
await client.lTrim(key('recent'), 0, 49);

// 4. Publish to pub/sub
await client.publish('indexer:progress', JSON.stringify(pubsubPayload));
```

---

## Info Server Changes (`info-server.ts`)

### New route: `GET /api/progress`

```typescript
if (url.pathname === '/api/progress') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Subscribe to Redis pub/sub
  const subscriber = client.duplicate();
  await subscriber.connect();
  await subscriber.subscribe('indexer:progress', (message) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on('close', () => {
    subscriber.unsubscribe();
    subscriber.disconnect();
  });
  return;
}
```

### New route: `GET /api/snapshot`

Returns a JSON snapshot combining current head, stats, and recent items — for the initial page load before SSE kicks in.

```json
{
  "head": { "blockNumber": 12345, "timestamp": "..." },
  "stats": { "blocksIndexed": 500, "txsIndexed": 2340, "eventsIndexed": 89, "fraudDetected": 2, "lastBlockAt": "..." },
  "recent": [...]
}
```

### Dashboard (`GET /`)

- On page load, fetch `/api/snapshot` to render initial state
- Open `EventSource('/api/progress')` to receive live updates
- On each SSE message, update the DOM in-place — no page refresh, no polling

---

## Implementation Order

1. `src/redis/progress.ts` — helper functions to write head, stats, recent, and publish to pub/sub
2. Integrate `progress.ts` into `catchup.ts` after `processBlock()`
3. Add `GET /api/snapshot` endpoint to `info-server.ts`
4. Add `GET /api/progress` SSE endpoint to `info-server.ts`
5. Update the HTML dashboard in `renderDashboard()` to connect via `EventSource` and render live updates

---

## What Gets Displayed

| Section | Data Source | Description |
|---|---|---|
| Head block | `head.blockNumber` | Network head seen by indexer |
| Indexed block | `cursor.lastBlockNumber` | Fully processed block |
| Lag | `head.blockNumber - cursor.lastBlockNumber` | Blocks behind |
| Blocks indexed (total) | `stats.blocksIndexed` | All-time counter |
| Fraud detected | `stats.fraudDetected` | Highlighted prominently |
| Recent activity | `recent` list | Last 50 processed blocks |
| Live feed | SSE (`isFraud` flag) | Real-time block processing |