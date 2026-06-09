/**
 * QA Helper: Emit DoubleFinancingPreventer events for indexer testing.
 * Uses ethers v6 and the local test key.
 *
 * Run after network start and contract deploy:
 *   node scripts/emit-dfp-events.js
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Paths resolved relative to this script's location
const SCRIPT_DIR = __dirname;
const DEPLOYMENT_PATH = path.resolve(SCRIPT_DIR, '../smart_contracts/deployments/deployment.json');
const ARTIFACT_PATH = path.resolve(SCRIPT_DIR, '../smart_contracts/contracts/DoubleFinancingPreventer.json');

// Test private key from quorum-test-network/smart_contracts/scripts/keys.js (account a)
const TEST_PRIVATE_KEY = '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63';
const RPC_URL = 'http://127.0.0.1:8545';

async function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`Deployment file not found at ${DEPLOYMENT_PATH}. Run deploy_double_financing.js first.`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf-8'));
}

async function loadArtifact() {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(`Artifact not found at ${ARTIFACT_PATH}.`);
  }
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));
}

async function registerAsset(contract, signer, assetId) {
  console.log(`  [registerAsset] assetId=${assetId}`);
  const tx = await contract.connect(signer).registerAsset([assetId]);
  const receipt = await tx.wait();
  console.log(`  [registerAsset] tx=${receipt.hash} block=${receipt.blockNumber}`);
  return receipt;
}

async function requestFinancing(contract, signer, assetId, amountWei) {
  console.log(`  [requestFinancing] assetId=${assetId} amount=${amountWei}`);
  const tx = await contract.connect(signer).requestFinancing([assetId, amountWei]);
  const receipt = await tx.wait();
  console.log(`  [requestFinancing] tx=${receipt.hash} block=${receipt.blockNumber}`);
  return receipt;
}

async function attemptFraud(contract, signer, assetId, amountWei) {
  console.log(`  [attemptFraud] Calling requestFinancing AGAIN on assetId=${assetId} (should emit FraudAttemptDetected, no revert)`);
  const tx = await contract.connect(signer).requestFinancing([assetId, amountWei]);
  const receipt = await tx.wait();
  console.log(`  [attemptFraud] tx=${receipt.hash} block=${receipt.blockNumber}`);
  console.log(`  [attemptFraud] NOTE: Transaction succeeded because requestFinancing does NOT revert on pledged asset`);
  return receipt;
}

async function registerFile(contract, signer, assetId, fileURI, fileHash) {
  console.log(`  [registerFile] assetId=${assetId} fileURI=${fileURI} fileHash=${fileHash}`);
  const tx = await contract.connect(signer).registerFile([assetId, fileURI, fileHash]);
  const receipt = await tx.wait();
  console.log(`  [registerFile] tx=${receipt.hash} block=${receipt.blockNumber}`);
  return receipt;
}

async function main() {
  console.log('\n=== DFP Event Emitter QA Helper ===\n');

  const deployment = await loadDeployment();
  const artifact = await loadArtifact();

  const contractAddress = deployment.contractAddress;
  const chainId = parseInt(deployment.chainId, 10);

  console.log(`Chain ID:    ${chainId}`);
  console.log(`Contract:    ${contractAddress}`);
  console.log(`RPC:        ${RPC_URL}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL, chainId);
  const signer = new ethers.Wallet(TEST_PRIVATE_KEY, provider);
  console.log(`Signer:     ${signer.address}\n`);

  const contract = new ethers.Contract(contractAddress, artifact.abi, provider);

  // Use timestamp-based assetId to avoid collisions
  const baseAssetId = Date.now() % 1000000;
  console.log(`Asset ID base: ${baseAssetId}\n`);

  // 1. Register asset
  console.log('--- STEP 1: Register Asset ---');
  const assetId1 = baseAssetId;
  await registerAsset(contract, signer, assetId1);

  // 2. Request financing (normal flow)
  console.log('\n--- STEP 2: Request Financing (normal) ---');
  const amountWei = ethers.parseEther('100');
  await requestFinancing(contract, signer, assetId1, amountWei);

  // 3. Attempt fraud (second request on same asset - does NOT revert)
  console.log('\n--- STEP 3: Attempt Fraud (second requestFinancing on same asset) ---');
  console.log('  NOTE: This emits FraudAttemptDetected and AccountFlagged but does NOT revert');
  const fraudAmountWei = ethers.parseEther('50');
  await attemptFraud(contract, signer, assetId1, fraudAmountWei);

  // 4. Register a different asset with a file
  console.log('\n--- STEP 4: Register Asset with File ---');
  const assetId2 = baseAssetId + 1;
  await registerAsset(contract, signer, assetId2);

  const fileURI = 'ipfs://QmT8mPsmxJkHHVvMLRKPeQqogLn8mjy3TnS5CLKlFKwSWG';
  const fileHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  await registerFile(contract, signer, assetId2, fileURI, fileHash);

  console.log('\n=== Done ===');
  console.log('Events emitted: AssetRegistered, FinancingRecorded, FraudAttemptDetected, AccountFlagged, FileRegistered');
  console.log('Query Redis: docker compose exec redis redis-cli FT.SEARCH idx:dfp_events \'*\' LIMIT 0 10\n');
}

main().catch(err => {
  console.error('\nError:', err.message || err);
  process.exit(1);
});
