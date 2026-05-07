/**
 * ============================================================================
 * DEPLOY DoubleFinancingPreventer SMART CONTRACT
 * ============================================================================
 *
 * Deploys the fraud prevention contract to the Quorum test network.
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const RPC_URL = 'http://127.0.0.1:8545';
const PRIVATE_KEY = '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63';
const ACCOUNT_ADDRESS = '0xfe3b557e8fb62b89f4916b721be55ceb828dbd73';

// ============================================================================
// HELPERS
// ============================================================================

function logStep(stepNum, title) {
    console.log('\n' + '='.repeat(70));
    console.log(`STEP ${stepNum}: ${title}`);
    console.log('='.repeat(70));
}

function logInfo(label, value) {
    console.log(`  ${label.padEnd(25)}: ${value}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║         DOUBLE FINANCING PREVENTER - DEPLOY CONTRACT                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    // STEP 1: Connect
    logStep(1, 'CONNECT TO BLOCKCHAIN');
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    logInfo('Network', network.name);
    logInfo('Chain ID', network.chainId);
    logInfo('Block Number', blockNumber.toString());

    // STEP 2: Create wallet
    logStep(2, 'CREATE WALLET (SIGNER)');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    logInfo('Wallet Address', wallet.address);
    const balance = await provider.getBalance(wallet.address);
    logInfo('Balance', ethers.formatEther(balance) + ' ETH');

    // STEP 3: Load contract
    logStep(3, 'LOAD COMPILED CONTRACT');
    const contractPath = path.resolve(__dirname, '../contracts/DoubleFinancingPreventer.json');
    const contractJson = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const abi = contractJson.abi;
    const bytecode = contractJson.evm.bytecode.object;
    logInfo('ABI Loaded', abi.length + ' functions/events');
    logInfo('Bytecode Size', bytecode.length / 2 + ' bytes');

    // STEP 4: Deploy
    logStep(4, 'DEPLOY CONTRACT');
    console.log('  Deploying...');
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy();
    logInfo('Transaction Hash', contract.deploymentTransaction().hash);

    // Wait for confirmation
    console.log('  Waiting for confirmation...');
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    logInfo('Contract Address', address);

    // STEP 5: Save address
    logStep(5, 'SAVE DEPLOYMENT INFO');
    const deploymentInfo = {
        network: network.name,
        chainId: network.chainId.toString(),
        contractAddress: address,
        deployer: wallet.address,
        blockNumber: blockNumber.toString(),
        timestamp: new Date().toISOString()
    };
    const deployPath = path.resolve(__dirname, '../deployments/deployment.json');
    fs.mkdirSync(path.dirname(deployPath), { recursive: true });
    fs.writeFileSync(deployPath, JSON.stringify(deploymentInfo, null, 2));
    logInfo('Saved To', deployPath);

    // STEP 6: Verify deployment
    logStep(6, 'VERIFY DEPLOYMENT');
    console.log('  Testing getAssetInfo(0) to verify contract works...');
    const result = await contract.getAssetInfo(0);
    logInfo('Asset 0 Query', 'Works! Contract is functional');
    const isFree = await contract.isAssetFree(0);
    logInfo('isAssetFree(0)', isFree ? 'true (not found)' : 'false');

    console.log('\n' + '='.repeat(70));
    console.log('DEPLOYMENT SUCCESSFUL!');
    console.log('='.repeat(70));
    console.log('\nContract Address: ' + address);
    console.log('Save this address - you need it to interact with the contract!\n');

    return address;
}

main().catch(err => {
    console.error('Deployment failed:', err);
    process.exit(1);
});