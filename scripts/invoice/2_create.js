/**
 * 2_create.js - Create a New Invoice
 * 
 * Mints a new invoice token on the blockchain.
 * This represents a company "creating" an invoice to be paid.
 */

const { connectWallet, loadContractAddress } = require('./utils');
const ethers = require('ethers');

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    CREATE INVOICE                                    ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    const { wallet } = await connectWallet();
    const contract = require('./utils').getContract(wallet);

    // Get invoice count before
    const countBefore = await contract.invoiceCount();

    // Parse arguments
    const amount = process.argv[2] || '0.01';
    const amountWei = ethers.parseEther(amount);
    const payer = process.argv[3] || wallet.address;

    console.log('\n  Creating invoice:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  Amount: ${amount} ETH (${amountWei} wei)`);
    console.log(`  Payer:  ${payer}`);
    console.log(`  Payee:  ${wallet.address} (deployer)`);

    console.log('\n  Sending mintInvoice transaction...');
    const tx = await contract.mintInvoice(amountWei, payer);
    console.log(`  TX Hash: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    // Parse event
    const event = receipt.logs[0];
    const parsed = contract.interface.parseLog(event);
    const invoiceId = parsed.args[0];

    const countAfter = await contract.invoiceCount();

    console.log('\n  ┌───────────────────────────────────────────────────────────────┐');
    console.log('  │                    INVOICE CREATED                           │');
    console.log('  ├───────────────────────────────────────────────────────────────┤');
    console.log(`  │  Invoice ID:    ${invoiceId.toString().padEnd(38)}│`);
    console.log(`  │  TX Hash:       ${receipt.hash.slice(0, 40)}...`.padEnd(39) + '│');
    console.log(`  │  Block:         ${receipt.blockNumber.toString().padEnd(38)}│`);
    console.log(`  │  Gas Used:      ${receipt.gasUsed.toString().padEnd(38)}│`);
    console.log('  └───────────────────────────────────────────────────────────────┘');
    console.log('\n  Next: node scripts/invoice/4_read.js', invoiceId.toString());
    console.log('       node scripts/invoice/3_list.js\n');
}

main().catch((err) => {
    console.error('\n  ✗ Error:', err.message);
    process.exit(1);
});
