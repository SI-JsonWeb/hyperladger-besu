# Redis Search Dashboard — Design Proposal

## Overview

Add a search feature to the `info-server.ts` dashboard that demonstrates Redis Search by letting users query blocks, transactions, and DFP contract events directly from the browser.

---

## Search Interface

### Index Picker

Three tabs above the search bar: **Blocks**, **Transactions**, **Events**. Default to **Events**.

Tabs styled as pill buttons. Active tab gets the `--accent` color.

### Search Bar

A single text input with a submit button.

Placeholder text per index:
- Blocks: `Search by block number, hash...`
- Transactions: `Search by tx hash, from/to address...`
- Events: `Search by event name, borrower, assetId...`

On submit, fetch `GET /api/search?q={query}&index={index}` and render results.

---

## API Endpoint

```
GET /api/search?q={query}&index={index}
```

Query parameters:
- `q` — free-text search string (required)
- `index` — one of `blocks`, `txs`, `events` (default: `events`)

Response shape:
```json
{
  "query": "FraudAttemptDetected",
  "index": "events",
  "command": "FT.SEARCH idx:dfp_events @eventName:{FraudAttemptDetected} LIMIT 0 20",
  "total": 3,
  "returned": 3,
  "results": [
    {
      "key": "dfp:event:1337:123:0:0",
      "fields": {
        "eventName": "FraudAttemptDetected",
        "blockNumber": "123",
        "txHash": "0xabc...",
        "reason": "Asset already financed"
      }
    }
  ]
}
```

The `command` field echoes the actual Redis Search command for educational value.

---

## Redis Search Commands

### Events (default)
```
FT.SEARCH idx:dfp_events @eventName:{query} LIMIT 0 20
```
If `query` contains spaces or special chars, wrap in curly braces for tag matching. Fall back to wildcard `*query*` for prefix/fuzzy matches.

### Blocks
```
FT.SEARCH idx:besu_blocks @number:{query} LIMIT 0 20
```
For block number queries, try numeric match first.

### Transactions
```
FT.SEARCH idx:besu_txs @from:{query} LIMIT 0 20
FT.SEARCH idx:besu_txs @to:{query} LIMIT 0 20
FT.SEARCH idx:besu_txs @hash:{query} LIMIT 0 20
```
Fan out to all three field searches and merge unique results.

---

## Result Cards

### Events Card
- `eventName` — large, prominent
- `blockNumber` — label + value
- `txHash` — truncated to 8 chars + `...`
- Relevant field based on event type:
  - `FraudAttemptDetected` / `AccountFlagged` → `reason`
  - `FinancingRecorded` → `borrower`, `lender`
  - `AssetRegistered` → `assetId`, `owner`
  - `LienReleased` → `assetId`
  - `FileRegistered` → `fileURI`
- Fraud events (`FraudAttemptDetected`, `AccountFlagged`) get a red accent border and a `FRAUD` badge

### Blocks Card
- `number` — large
- `timestamp` — formatted date/time
- `txCount` — number of transactions

### Transactions Card
- `hash` — truncated to 8 chars + `...`
- `from` → `to` — addresses truncated
- `valueWei` — formatted as ETH or Wei string
- `status` — `success` (green) or `failed` (red)

---

## Query Echo

Below the search bar, show the raw `FT.SEARCH` command in a monospace block, muted color:

```
FT.SEARCH idx:dfp_events @eventName:{FraudAttemptDetected} LIMIT 0 20
```

---

## Error Handling

- Empty query → show placeholder prompt, no request
- No results → show "No results for 'query' in index 'events'"
- Redis error → show error message in results area

---

## Dashboard Integration

The search section lives below the existing stats grid, before the footer.

Layout:
```
[Blocks] [Transactions] [Events]  ← tabs
[__________________] [Search]      ← search bar
FT.SEARCH idx:dfp_events ...      ← query echo (monospace, muted)
[result card] [result card]        ← card grid
[result card] [result card]
```

Max 20 results. Fraud cards have red border + badge.

---

## Implementation Order

1. `GET /api/search` endpoint in `info-server.ts` — parse query params, run `FT.SEARCH`, return JSON
2. Add index tabs and search bar HTML to `renderDashboard()`
3. Add client-side fetch on form submit
4. Render result cards with fraud highlighting
5. Show query echo below search bar
