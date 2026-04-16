/**
 * ============================================================================
 * INVOICE TUTORIAL - LEARNING BLOCKCHAIN PROGRAMMING
 * ============================================================================
 * 
 * PURPOSE:
 * This script teaches you how to interact with a blockchain using Ethereum's
 * ethers.js library. We'll deploy a smart contract and tokenize an invoice.
 * 
 * BLOCKCHAIN CONCEPTS COVERED:
 * 
 * 1. PROVIDER: Connects to the blockchain network (like a gateway)
 * 2. SIGNER/WALLET: Pays for transactions (gas) and signs them
 * 3. CONTRACT: Deployed code that lives on the blockchain
 * 4. TRANSACTION: Write operation that changes state (costs gas)
 * 5. CALL: Read operation that doesn't change state (free)
 * 6. RECEIPT: Proof that a transaction was included in a block
 * 7. GAS: The fee you pay to have your transaction processed
 * 
 * HOW TO RUN:
 *   cd smart_contracts
 *   npm run compile
 *   node scripts/tutorial_invoice.js
 * 
 * PREREQUISITES:
 * - Besu node must be running locally on http://127.0.0.1:8545
 * - The private key below must have funds (this key has 100 ETH in dev)
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

// RPC endpoint of your local Besu node
const RPC_URL = 'http://127.0.0.1:8545';

// Account private key - IN DEVELOPMENT ONLY! Never commit real keys!
const PRIVATE_KEY = '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63';

// Pre-funded test account address
const ACCOUNT_ADDRESS = '0xfe3b557e8fb62b89f4916b721be55ceb828dbd73';

// ============================================================================
// STEP 0: HELPER FUNCTIONS
// ============================================================================

function logStep(stepNum, title, description) {
    console.log('\n' + '='.repeat(70));
    console.log(`STEP ${stepNum}: ${title}`);
    console.log('='.repeat(70));
    console.log(description);
    console.log('-'.repeat(70));
}

function logInfo(label, value) {
    console.log(`  ${label.padEnd(25)}: ${value}`);
}

// ============================================================================
// MAIN TUTORIAL
// ============================================================================

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║         INVOICE TOKENIZATION TUTORIAL - LEARNING BLOCKCHAIN           ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════╣');
    console.log('║  We will:                                                              ║');
    console.log('║  1. Connect to the local Besu blockchain                               ║');
    console.log('║  2. Load our wallet (signer)                                           ║');
    console.log('║  3. Deploy the InvoiceTutorial smart contract                          ║');
    console.log('║  4. Tokenize (mint) a new invoice                                      ║');
    console.log('║  5. Read the invoice back from the blockchain                          ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    // =========================================================================
    // STEP 1: CONNECT TO THE BLOCKCHAIN
    // =========================================================================
    
    logStep(1, 'CONNECT TO BLOCKCHAIN', `
    A "Provider" is your gateway to the blockchain. It knows how to:
    - Read blockchain state
    - Send transactions to be processed
    - Listen for new blocks
    
    Think of it like your internet browser connecting to a web server.
    `);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Check if we can connect
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    
    logInfo('Network Name', network.name);
    logInfo('Chain ID', network.chainId);
    logInfo('Current Block', blockNumber);
    logInfo('Provider', 'Connected to Besu RPC');

    // =========================================================================
    // STEP 2: LOAD WALLET (SIGNER)
    // =========================================================================

    logStep(2, 'LOAD WALLET (SIGNER)', `
    A "Signer" is a wallet that can sign transactions. It's like your browser's
    "Login" - it proves you own the account and authorizes transactions.
    
    The private key below is a TEST key with pre-funded Ether (ETH) on it.
    In production, you'd use EthSigner or a hardware wallet for security.
    
    GAS EXPLANATION:
    Every state-changing operation on Ethereum costs "gas". 
    Gas is paid by this account. Think of it like a postage fee.
    `);

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    const balanceInEth = ethers.formatEther(balance);

    logInfo('Wallet Address', wallet.address);
    logInfo('Balance', `${balanceInEth} ETH`);
    logInfo('Private Key', '(shown in script - DEV ONLY!)');
    console.log('  ✓ Wallet loaded and connected to provider');

    // =========================================================================
    // STEP 3: DEPLOY SMART CONTRACT
    // =========================================================================

    logStep(3, 'DEPLOY SMART CONTRACT', `
    A smart contract is code that lives permanently on the blockchain.
    Think of it like a "digital safe" with rules built into it.
    
    DEPLOYMENT PROCESS:
    1. We compile Solidity code -> bytecode (machine code)
    2. We send bytecode to the blockchain (this costs gas!)
    3. The blockchain creates a NEW address for this contract
    4. Anyone can now interact with the contract at that address
    
    The contract code defines:
    - What data can be stored (Invoices)
    - What operations are allowed (mint, pay, read)
    - Who can perform each operation (access control)
    `);

    // Read the compiled contract ABI and bytecode
    const contractPath = path.resolve(__dirname, '../contracts/InvoiceTutorial.json');
    
    if (!fs.existsSync(contractPath)) {
        console.error('ERROR: InvoiceTutorial.json not found!');
        console.error('Please run: npm run compile');
        process.exit(1);
    }

    const contractArtifact = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const { abi, evm } = contractArtifact;
    const bytecode = evm.bytecode.object;

    console.log(`  Contract ABI loaded (${abi.length} functions/events)`);
    console.log(`  Bytecode size: ${bytecode.length / 2} bytes`);

    // Create a Contract factory
    // The factory knows how to deploy new instances of this contract
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    console.log('\n  Deploying contract... (this may take a few seconds)');

    // Deploy! This creates a transaction that costs gas
    const contract = await factory.deploy();
    
    // Wait for the transaction to be mined (included in a block)
    console.log('  Waiting for deployment transaction to be mined...');
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    const deployTx = contract.deploymentTransaction();
    const deployReceipt = await deployTx.wait();

    logInfo('Contract Address', contractAddress);
    logInfo('Deployment Block', deployReceipt.blockNumber);
    logInfo('Gas Used', deployReceipt.gasUsed.toString());
    logInfo('Transaction Hash', deployReceipt.hash);
    console.log('  ✓ Contract deployed successfully!');

    // =========================================================================
    // STEP 4: MINT (TOKENIZE) AN INVOICE
    // =========================================================================

    logStep(4, 'TOKENIZE AN INVOICE', `
    Now that our contract is live, let's create our first "invoice token".
    
    TOKENIZATION MEANS:
    - Creating a permanent, tamper-proof record on the blockchain
    - The invoice exists as a unique digital asset
    - Anyone can verify it exists and its current state
    
    "mintInvoice" FUNCTION:
    - Takes an amount (wei) and a payer address
    - Creates a new Invoice struct in the contract's storage
    - Emits an "InvoiceCreated" event (for off-chain listeners)
    - Returns the new invoice ID
    
    THIS IS A TRANSACTION:
    - It MODIFIES state on the blockchain
    - It costs GAS (fees paid to validators)
    - It requires a signature from our wallet
    `);

    // Example invoice: 0.01 ETH = 10000000000000000 wei
    const invoiceAmount = ethers.parseEther('0.01');
    const payerAddress = '0x627306090abaB3A6e1400e9345bC60c78a8BEf57'; // Another test account

    console.log(`\n  Creating invoice:`);
    logInfo('Amount', `${ethers.formatEther(invoiceAmount)} ETH (${invoiceAmount.toString()} wei)`);
    logInfo('Payer', payerAddress);
    logInfo('Payee (msg.sender)', wallet.address);

    console.log('\n  Sending mintInvoice transaction...');

    // Call the mintInvoice function - this creates a transaction
    const mintTx = await contract.mintInvoice(invoiceAmount, payerAddress);
    
    console.log('  Transaction sent! Hash:', mintTx.hash);
    console.log('  Waiting for transaction to be mined...');

    // Wait for the transaction to be included in a block
    const mintReceipt = await mintTx.wait();

    logInfo('Transaction Hash', mintReceipt.hash);
    logInfo('Block Number', mintReceipt.blockNumber.toString());
    logInfo('Gas Used', mintReceipt.gasUsed.toString());
    console.log('  ✓ Invoice tokenized successfully!');

    // Extract the InvoiceCreated event to get the new invoice ID
    const event = mintReceipt.logs[0];
    const parsedEvent = contract.interface.parseLog(event);
    const invoiceId = parsedEvent.args[0]; // First arg is the invoice ID

    logInfo('New Invoice ID', invoiceId.toString());

    // =========================================================================
    // STEP 5: READ THE INVOICE (VIEW/CALL)
    // =========================================================================

    logStep(5, 'READ INVOICE FROM BLOCKCHAIN', `
    Now let's verify our invoice exists by reading it from the blockchain.
    
    TWO WAYS TO INTERACT WITH CONTRACTS:
    
    1. CALL (Read-Only):
       - Does NOT modify blockchain state
       - Executes instantly on ONE node
       - Does NOT cost gas (free!)
       - Use for: reading data, checking balances
    
    2. TRANSACTION (Write):
       - MODIFIES blockchain state
       - Takes time (must be mined)
       - Costs gas (paid to validators)
       - Returns a receipt with execution results
    
    getInvoice() is a "view" function - it only reads data.
    `);

    console.log('\n  Calling getInvoice() to read invoice data...');

    // This is a CALL (not a transaction) - it doesn't cost gas
    const invoice = await contract.getInvoice(invoiceId);

    console.log('\n  ┌─────────────────────────────────────────┐');
    console.log('  │         INVOICE DETAILS                 │');
    console.log('  ├─────────────────────────────────────────┤');
    logInfo('  │ Invoice ID', invoice.id.toString().padEnd(27) + '│');
    logInfo('  │ Amount', `${ethers.formatEther(invoice.amount)} ETH`.padEnd(27) + '│');
    logInfo('  │ Payer', invoice.payer.padEnd(27) + '│');
    logInfo('  │ Payee', invoice.payee.padEnd(27) + '│');
    logInfo('  │ Paid?', invoice.isPaid ? 'No' : 'No'.padEnd(27) + '│'); // Will be false
    logInfo('  │ Created At', new Date(Number(invoice.createdAt) * 1000).toISOString() + '     │');
    console.log('  └─────────────────────────────────────────┘');

    // =========================================================================
    // STEP 6: PAY THE INVOICE
    // =========================================================================

    logStep(6, 'PAY THE INVOICE (STATE CHANGE)', `
    Let's simulate paying the invoice. This is another TRANSACTION
    because it modifies the "isPaid" state variable.
    
    After this, the invoice will be marked as "paid" on the blockchain.
    `);

    console.log('\n  Calling payInvoice()...');

    const payTx = await contract.payInvoice(invoiceId);
    console.log('  Transaction sent:', payTx.hash);
    
    const payReceipt = await payTx.wait();
    logInfo('Block Number', payReceipt.blockNumber.toString());

    // Verify the invoice is now marked as paid
    // We need to make a fresh call since we just changed state
    const updatedInvoice = await contract.getInvoice(invoiceId);

    console.log('\n  ┌─────────────────────────────────────────┐');
    console.log('  │         UPDATED INVOICE                 │');
    console.log('  ├─────────────────────────────────────────┤');
    logInfo('  │ Invoice ID', updatedInvoice.id.toString().padEnd(27) + '│');
    logInfo('  │ Paid?', 'YES ✓'.padEnd(27) + '│');
    console.log('  └─────────────────────────────────────────┘');

    // =========================================================================
    // DONE!
    // =========================================================================

    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    TUTORIAL COMPLETE!                                   ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════╣');
    console.log('║  SUMMARY:                                                              ║');
    console.log('║  ✓ Connected to Besu blockchain                                       ║');
    console.log('║  ✓ Deployed InvoiceTutorial contract                                  ║');
    console.log('║  ✓ Tokenized an invoice (created on-chain record)                    ║');
    console.log('║  ✓ Read the invoice using a free CALL                                 ║');
    console.log('║  ✓ Updated the invoice state (paid) with a TRANSACTION               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log('\n  Next Steps:');
    console.log('  - Try modifying the smart contract (add more fields, access control)');
    console.log('  - Create more invoices with different amounts and payers');
    console.log('  - Explore privacy features using Tessera (private transactions)');
    console.log('\n');
}

// Run the tutorial
main().catch((error) => {
    console.error('\n❌ ERROR:', error.message || error);
    if (error.code === 'ECONNREFUSED') {
        console.error('\n⚠️  Could not connect to Besu node.');
        console.error('   Is the network running? Try: docker compose up -d');
    }
    process.exit(1);
});
