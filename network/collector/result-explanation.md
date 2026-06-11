**Result JSON — Explanation**

This document explains the fields found in the `result.json` file (cached output from `send-private-tx.js`). It's a concise mapping of JSON keys to their meaning and where they originate in the transaction/block lifecycle.

**Block Fields**
- **`hash`**: The block's Keccak-256 hash (unique identifier).
- **`parentHash`**: The hash of the previous block in the chain.
- **`number`**: Block height (integer).
- **`timestamp`**: UNIX epoch seconds when the block was sealed.
- **`timestampISO`**: ISO-8601 representation of `timestamp` (UTC).
- **`miner`**: Address of the account (validator/node) that produced/committed the block.
- **`gasLimit`**: Maximum gas allowed for the block (big integer).
- **`gasUsed`**: Total gas consumed by all transactions in this block.
- **`gasUsedPercent`**: Human-friendly percent of `gasUsed / gasLimit`.
- **`size`**: Block size in bytes.
- **`transactions`**: Array of transactions included in the block (see Transaction Fields).
- **`transactionCount`**: Number of transactions in the `transactions` array.

**Transaction Fields (per item in `transactions`)**
- **`hash`**: Transaction hash (Keccak-256 of signed tx).
- **`blockHash` / `blockNumber`**: The block that contains this transaction.
- **`from`**: Sender address that signed the transaction.
- **`to`**: Recipient address; for contract creation this may be a special value (or `null`).
- **`isContractDeploy`**: Boolean showing whether this transaction deployed a contract.
- **`isPrivate`**: Boolean indicating whether this transaction is a private (privacy-enabled) transaction. `false` means public.
- **`valueWei` / `valueEth`**: Transfer amount in wei and converted to Ether string for convenience.
- **`gas` / `gasPrice`**: Transaction gas limit and gas price used (note many private chains use `0` gasPrice).
- **`nonce`**: Sender's account nonce at time of signing.
- **`transactionIndex`**: Index of this transaction within the block (0-based).
- **`input`**: Parsed transaction input data; contains:
  - **`raw`**: Raw hex payload.
  - **`type`**: Classification (e.g., `contract_call`).
  - **`methodId`**: First 4 bytes of calldata (function selector) when calling a contract.
  - **`method`**: Decoded method name if ABI-based decoding was possible; `unknown` otherwise.
  - **`paramsRaw`**: Remaining calldata (hex) after the selector.
- **`timestamp` / `timestampISO`**: Block timestamp repeated per-transaction for convenience.
- **`type`**: Transaction type (EIP-2718 / legacy identifier); `0` indicates legacy.

**Extra Data**
- **`extraData.validators`**: Array of validator addresses (config or consensus metadata).
- **`validatorCount`**: Number of validators recorded in `extraData`.
- **`round`**: Consensus round index (if applicable to the consensus algorithm).

**How this maps to `send-private-tx.js` output**
- The `decodePrivateReceipt` function in `send-private-tx.js` produces a subset of these values for private transactions: `privacyGroupId`, `from`, `to`, `status`, `output`, `logs`, `blockNumber`, `gasUsed`.
- In this `result.json`, the transaction shows `isPrivate: false`, so this block/tx was treated as a public transaction; private transactions would typically surface additional privacy fields such as `privacyGroupId` and use `priv_getTransactionReceipt` on participant nodes.

**Notes & troubleshooting hints**
- If you expect a private transaction but `isPrivate` is `false`, ensure the transaction was submitted with the correct Tessera `privateFrom`/`privateFor` keys and that the submitting node used the privacy-enabled RPC helper (e.g., `web3js-quorum.priv.generateAndSendRawTransaction`).
- Use `hash` to look up the transaction or block with RPC calls `eth_getTransactionByHash` / `eth_getBlockByHash`.
- For private receipts, check participant nodes with `priv_getTransactionReceipt` instead of `eth_getTransactionReceipt`.

**File**
- This explanation was generated for: [network/collector/result.json](network/collector/result.json)

---

If you want, I can also: add inline links from each JSON key to the corresponding code in `network/collector/send-private-tx.js`, or expand the `input` decoding with ABI examples.
