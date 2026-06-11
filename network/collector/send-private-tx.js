// ── Send a private transaction between node1 and node2 ──────
// Usage: node send-private-tx.js

const Web3 = require('web3');
const Web3Quorum = require('web3js-quorum');

// ── Config ───────────────────────────────────────────────────
const NODE1_URL     = 'http://localhost:8545';   // sender's besu node
const NODE2_URL     = 'http://localhost:8546';   // receiver's besu node
const NODE3_URL     = 'http://localhost:8547';   // non-participant node (should not see the tx)
const TESSERA_URL   = process.env.TESSERA_URL || 'http://localhost:9081';

// Tessera public keys — read from your generated files
// cat tessera1/data/tessera.pub
// cat tessera2/data/tessera.pub
const TESSERA1_KEY  = 'dvpcczUNquUhAhj4ffw73uTx5Sfl7sDCIMHDmfVElEI=';
const TESSERA2_KEY  = 'Q3fqyh9XNvt+dI+1NmMU7kVdp98/jf+a/3F4kM7E4DI=';

// Sender wallet — use one of your pre-funded accounts
const SENDER_PRIVATE_KEY = '0xd8e3ce0d0b8eb27aeb62410357369245cdcde3ebc6377ff2ef7969d7690f834f';
const SENDER_ADDRESS     = '0x161c7134982ab79de80eb8db5154665ca88e356a';
const RECIPIENT_ADDRESS   = '0x1ba9867f53ff9c80aad8e4b965780a58c20505d6';

// ── RPC helper ───────────────────────────────────────────────
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

// ── Get nonce ────────────────────────────────────────────────
async function getNonce(address) {
  const hex = await rpc(NODE1_URL, 'eth_getTransactionCount', [address, 'latest']);
  return parseInt(hex, 16);
}

// ── Sign and send private transaction (Besu / web3js-quorum) ────────────
async function sendPrivateTransaction({
  from,
  to,
  data,
  privateFrom,
  privateFor,
  privateKey
}) {
  const web3 = new Web3(NODE1_URL);
  const web3quorum = new Web3Quorum(web3, { privateUrl: TESSERA_URL });
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);

  // Get current nonce
  const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

  console.log('\nSending private transaction:');
  console.log('  from:        ', from);
  console.log('  to:          ', to);
  console.log('  privateFrom: ', privateFrom);
  console.log('  privateFor:  ', privateFor);
  console.log('  data:        ', data);

  const txOptions = {
    chainId: await web3.eth.getChainId(),
    nonce,
    gasPrice: 0,
    gasLimit: 0x3d090,
    value: 0,
    data: data || '0x',
    to: to || null,
    from: account,
    isPrivate: true,
    privateKey: privateKey.slice(2),
    privateFrom,
    privateFor,
  };

  const txHash = await web3quorum.priv.generateAndSendRawTransaction(txOptions);

  console.log('\nTransaction hash:', txHash);
  return txHash;
}

// ── Wait for receipt ─────────────────────────────────────────
async function waitForReceipt(txHash, maxRetries = 30) {
  console.log('\nWaiting for receipt...');
  const web3 = new Web3(NODE1_URL);
  const web3quorum = new Web3Quorum(web3, { privateUrl: TESSERA_URL });

  const receipt = await web3quorum.priv.waitForTransactionReceipt(txHash);

  console.log('\n✅ Private transaction confirmed!');
  console.log('  privacyGroupId:', receipt.privacyGroupId);
  console.log('  status:        ', receipt.status === '0x1' ? 'success' : 'failed');
  console.log('  logs:          ', receipt.logs?.length || 0, 'events');
  return receipt;
}

// ── Decode private receipt ────────────────────────────────────
function decodePrivateReceipt(txHash, receipt) {
  return {
    txHash,
    privacyGroupId: receipt.privacyGroupId,
    from:           receipt.from?.toLowerCase(),
    to:             receipt.to?.toLowerCase(),
    status:         receipt.status === '0x1' ? 'success' : 'failed',
    output:         receipt.output,
    logs:           (receipt.logs || []).map(log => ({
      address:  log.address?.toLowerCase(),
      topics:   log.topics,
      data:     log.data,
    })),
    blockNumber:    parseInt(receipt.blockNumber, 16),
    gasUsed:        parseInt(receipt.gasUsed, 16),
  };
}

// ── Main ─────────────────────────────────────────────────────
async function main() {

  // Example: simple private value transfer (no contract)
  // Just sending a private message/data between node1 and node2
  const txHash = await sendPrivateTransaction({
    from:        SENDER_ADDRESS,
    to:          RECIPIENT_ADDRESS,
    data:        '0x48656c6c6f20576f726c64', // "Hello World" in hex
    privateFrom: TESSERA1_KEY,
    privateFor:  [TESSERA2_KEY],             // only node2 can see this
    privateKey:  SENDER_PRIVATE_KEY,
  });

  // Wait for confirmation
  const receipt = await waitForReceipt(txHash);

  // Decode it
  const decoded = decodePrivateReceipt(txHash, receipt);
  console.log('\nDecoded private receipt:');
  console.log(JSON.stringify(decoded, null, 2));

  // Check from node2's perspective (participant)
  console.log('\nChecking from node2 (participant)...');
  const receipt2 = await rpc(NODE2_URL, 'priv_getTransactionReceipt', [txHash]);
  console.log('node2 can see it:', !!receipt2);
  console.log('node2 privacyGroupId:', receipt2?.privacyGroupId);

    // Check from node3's perspective (non-participant)
    console.log('\nChecking from node3 (non-participant)...');
    const receipt3 = await rpc(NODE3_URL, 'priv_getTransactionReceipt', [txHash]);
    console.log('node3 can see it:', !!receipt3);
    console.log('node3 privacyGroupId:', receipt3?.privacyGroupId);
}

main().catch(console.error);