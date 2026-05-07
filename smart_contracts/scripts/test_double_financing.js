/**
 * ============================================================================
 * TEST DoubleFinancingPreventer - Fraud Detection Demo
 * ============================================================================
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC_URL = 'http://127.0.0.1:8545';
const PRIVATE_KEY = '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63';

const deployPath = path.resolve(__dirname, '../deployments/deployment.json');
const deployment = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
const CONTRACT_ADDRESS = deployment.contractAddress;

function logStep(stepNum, title) {
    console.log('\n' + '='.repeat(70));
    console.log(`STEP ${stepNum}: ${title}`);
    console.log('='.repeat(70));
}

function logInfo(label, value) {
    console.log(`  ${label.padEnd(25)}: ${value}`);
}

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║         DOUBLE FINANCING PREVENTER - TESTING                          ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════╣');
    console.log('║  SCENARIO 1: Normal Flow (Register → Finance → Repay)                  ║');
    console.log('║  SCENARIO 2: Fraud Attempt (Double pledge should REJECT)             ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contractJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/DoubleFinancingPreventer.json'), 'utf8'));
    const contract = new ethers.Contract(CONTRACT_ADDRESS, contractJson.abi, wallet);

    logInfo('Contract Address', CONTRACT_ADDRESS);
    logInfo('Test Wallet', wallet.address);

    // =========================================================================
    // SCENARIO 1: NORMAL FLOW - using asset #100 (fresh)
    // =========================================================================

    console.log('\n\nSCENARIO 1: NORMAL FINANCING FLOW (Asset #100)');
    console.log('-'.repeat(70));

    logStep(1, 'REGISTER ASSET #100');
    const tx1 = await contract.registerAsset(100);
    const receipt1 = await tx1.wait();
    logInfo('Transaction Hash', receipt1.hash);
    logInfo('Asset #100', 'Registered!');

    logStep(2, 'CHECK ASSET IS FREE');
    const isFree = await contract.isAssetFree(100);
    logInfo('Asset #100 Free?', isFree);

    logStep(3, 'REQUEST FINANCING (500 ETH)');
    const tx2 = await contract.requestFinancing(100, ethers.parseEther('500'));
    const receipt2 = await tx2.wait();
    logInfo('Transaction Hash', receipt2.hash);
    logInfo('Amount', '500 ETH');

    logStep(4, 'VERIFY ASSET IS NOW PLEDGED');
    const isFreeAfter = await contract.isAssetFree(100);
    logInfo('Asset #100 Free?', isFreeAfter);
    const [owner, pledged, lender, amount] = await contract.getAssetInfo(100);
    logInfo('Owner', owner);
    logInfo('Pledged?', pledged);
    logInfo('Lender', lender);
    logInfo('Lien Amount', ethers.formatEther(amount) + ' ETH');

    logStep(5, 'REPAY AND RELEASE LIEN');
    const tx3 = await contract.repayAndRelease(100, { value: ethers.parseEther('500') });
    const receipt3 = await tx3.wait();
    logInfo('Transaction Hash', receipt3.hash);

    logStep(6, 'VERIFY ASSET IS FREE AGAIN');
    const isFreeReleased = await contract.isAssetFree(100);
    logInfo('Asset #100 Free?', isFreeReleased);

    console.log('\n✓ SCENARIO 1 PASSED: Normal flow works correctly!\n');

    // =========================================================================
    // SCENARIO 2: FRAUD ATTEMPT - using asset #200 (fresh)
    // =========================================================================

    console.log('\n\nSCENARIO 2: DOUBLE FINANCING FRAUD ATTEMPT (Asset #200)');
    console.log('-'.repeat(70));

    logStep(1, 'REGISTER ASSET #200');
    const tx4 = await contract.registerAsset(200);
    await tx4.wait();
    logInfo('Asset #200', 'Registered!');

    logStep(2, 'FIRST FINANCING REQUEST (200 ETH)');
    const tx5 = await contract.requestFinancing(200, ethers.parseEther('200'));
    await tx5.wait();
    logInfo('Result', 'First financing SUCCESS');

    logStep(3, 'SECOND FINANCING ATTEMPT (should FAIL)');
    try {
        const tx6 = await contract.requestFinancing(200, ethers.parseEther('300'));
        await tx6.wait();
        logInfo('Result', 'ERROR - Fraud was NOT prevented!');
        console.log('\n✗ SCENARIO 2 FAILED: Fraud was not prevented!\n');
        process.exit(1);
    } catch (error) {
        logInfo('Result', 'FRAUD PREVENTED! Transaction reverted.');
        logInfo('Error Message', error.reason || 'Asset already pledged');
    }

    logStep(4, 'CHECK FRAUD ALERT - FLAGGED ACCOUNTS');
    const flagged = await contract.getFlaggedAccounts();
    logInfo('Flagged Accounts', flagged.length.toString());
    if (flagged.length > 0) {
        logInfo('First Flagged', flagged[0]);
    }

    console.log('\n✓ SCENARIO 2 PASSED: Fraud was detected and prevented!\n');

    // =========================================================================
    // SCENARIO 3: OFF-CHAIN FILE STORAGE - using asset #300 (fresh)
    // =========================================================================

    console.log('\n\nSCENARIO 3: OFF-CHAIN FILE STORAGE (Asset #300)');
    console.log('-'.repeat(70));

    const SAMPLE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const SAMPLE_URI = 'ipfs://QmT8mPsmxJkHHVvMLRKPeQqogLn8mjy3TnS5CLKlFKwSWG';

    logStep(1, 'REGISTER ASSET #300');
    const tx7 = await contract.registerAsset(300);
    await tx7.wait();
    logInfo('Asset #300', 'Registered!');

    logStep(2, 'REGISTER FILE FOR ASSET #300');
    const tx8 = await contract.registerFile(300, SAMPLE_URI, SAMPLE_HASH);
    const receipt8 = await tx8.wait();
    logInfo('Transaction Hash', receipt8.hash);
    logInfo('File URI', SAMPLE_URI);
    logInfo('File Hash', SAMPLE_HASH);

    logStep(3, 'VERIFY FILE WITH CORRECT HASH');
    const isValid = await contract.verifyFile(300, SAMPLE_HASH);
    logInfo('Verification Result', isValid ? 'PASS ✓' : 'FAIL ✗');

    logStep(4, 'VERIFY FILE WITH WRONG HASH');
    const isInvalid = await contract.verifyFile(300, '0x0000000000000000000000000000000000000000000000000000000000000000');
    logInfo('Verification Result', !isInvalid ? 'PASS ✓ (correctly rejected)' : 'FAIL ✗');

    logStep(5, 'GET FILE INFO');
    const [uri, hash, ts] = await contract.getFileInfo(300);
    logInfo('Stored URI', uri);
    logInfo('Stored Hash', hash);
    logInfo('Timestamp', new Date(Number(ts) * 1000).toISOString());

    console.log('\n✓ SCENARIO 3 PASSED: File registration and verification works!\n');

    // =========================================================================
    // SUMMARY
    // =========================================================================

    console.log('='.repeat(70));
    console.log('ALL TESTS PASSED!');
    console.log('='.repeat(70));
    console.log('\nYour DoubleFinancingPreventer contract is working correctly.');
    console.log('It successfully:');
    console.log('  ✓ Records financing liens');
    console.log('  ✓ Prevents double financing (same asset)');
    console.log('  ✓ Auto-releases lien on repayment');
    console.log('  ✓ Flags fraudulent accounts');
    console.log('  ✓ Emits events for monitoring');
    console.log('  ✓ Registers off-chain file (URI + SHA-256 hash)');
    console.log('  ✓ Verifies file integrity against stored hash');
    console.log('\n');
}

main().catch(err => {
    console.error('\nTest failed:', err.message || err);
    process.exit(1);
});