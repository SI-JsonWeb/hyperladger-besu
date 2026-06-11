// ── Send a public transaction between node1 and node2 ──────
// Usage: node send-tx.js

const Web3 = require('web3');

// ── Config (same as send-private-tx.js) ───────────────────
const NODE1_URL     = 'http://localhost:8545';   // sender's besu node
const NODE2_URL     = 'http://localhost:8546';   // receiver's besu node
const NODE3_URL     = 'http://localhost:8547';   // other node
const TESSERA_URL   = process.env.TESSERA_URL || 'http://localhost:9081';

// Sender wallet — use one of your pre-funded accounts
const SENDER_PRIVATE_KEY = '0xd8e3ce0d0b8eb27aeb62410357369245cdcde3ebc6377ff2ef7969d7690f834f';
const SENDER_ADDRESS     = '0x161c7134982ab79de80eb8db5154665ca88e356a';
const RECIPIENT_ADDRESS  = '0x1ba9867f53ff9c80aad8e4b965780a58c20505d6';

// ── RPC helper (POST to a specific URL) ───────────────────
async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

// ── Sign and send a public transaction ─────────────────────
async function sendTransaction({ from, to, data, value = 0, privateKey }) {
  const web3 = new Web3(NODE1_URL);

  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

  console.log('\nSending public transaction:');
  console.log('  from:', from);
  console.log('  to:  ', to);
  console.log('  data:', data);

  const tx = {
    chainId: await web3.eth.getChainId(),
    nonce,
    gasPrice: 0,
    gas: 250000,
    to: to || null,
    value,
    data: data || '0x',
  };

  const signed = await web3.eth.accounts.signTransaction(tx, privateKey);
  const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  console.log('\nTransaction sent. hash:', sent.transactionHash || sent);
  return sent.transactionHash || sent;
}

// ── Wait for receipt (poll) ──────────────────────────────
async function waitForReceipt(txHash, maxRetries = 30, intervalMs = 2000) {
  console.log('\nWaiting for receipt...');
  const web3 = new Web3(NODE1_URL);

  for (let i = 0; i < maxRetries; i++) {
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (receipt) {
      console.log('\n✅ Transaction confirmed');
      return receipt;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Receipt not found within max retries');
}

// ── Decode receipt + transaction details ──────────────────
async function decodeReceipt(txHash, receipt) {
  const web3 = new Web3(NODE1_URL);
  const tx = await web3.eth.getTransaction(txHash);

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    from: tx?.from?.toLowerCase(),
    to: tx?.to?.toLowerCase(),
    status: receipt.status ? 'success' : 'failed',
    gasUsed: receipt.gasUsed,
    logs: receipt.logs || [],
    input: tx?.input || '0x',
    valueWei: tx?.value || '0',
  };
}

// ── Main ─────────────────────────────────────────────────
async function main() {
  const txHash = await sendTransaction({
    from: SENDER_ADDRESS,
    to: RECIPIENT_ADDRESS,
    data: '0x48656c6c6f20576f726c64', // "Hello World"
    privateKey: SENDER_PRIVATE_KEY,
  });

  const receipt = await waitForReceipt(txHash);
  const decoded = await decodeReceipt(txHash, receipt);

  console.log('\nDecoded receipt:');
  console.log(JSON.stringify(decoded, null, 2));

  // Verify visibility on other nodes (eth_getTransactionReceipt)
  console.log('\nChecking node2...');
  const r2 = await rpc(NODE2_URL, 'eth_getTransactionReceipt', [txHash]);
  console.log('node2 can see it:', !!r2);

  console.log('Checking node3...');
  const r3 = await rpc(NODE3_URL, 'eth_getTransactionReceipt', [txHash]);
  console.log('node3 can see it:', !!r3);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
