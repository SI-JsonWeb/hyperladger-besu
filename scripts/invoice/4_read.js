/**
 * 4_read.js - Read a Specific Invoice
 * 
 * Reads detailed information about a specific invoice.
 * Usage: node scripts/invoice/4_read.js <invoice_id>
 */

const { connectWallet } = require('./utils');
const ethers = require('ethers');

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    READ INVOICE                                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    const { wallet } = await connectWallet();
    const contract = require('./utils').getContract(wallet);

    // Get invoice ID from command line or prompt
    const invoiceId = process.argv[2] ? BigInt(process.argv[2]) : null;

    if (!invoiceId) {
        const count = await contract.invoiceCount();
        console.log('\n  Usage: node scripts/invoice/4_read.js <invoice_id>');
        console.log('  Current invoice count:', count.toString());
        if (count > 0n) {
            console.log('  Example: node scripts/invoice/4_read.js 1');
        }
        return;
    }

    console.log('\n  Reading invoice ID:', invoiceId.toString());

    try {
        const inv = await contract.getInvoice(invoiceId);

        console.log('\n  ┌───────────────────────────────────────────────────────────────┐');
        console.log('  │                    INVOICE DETAILS                             │');
        console.log('  ├───────────────────────────────────────────────────────────────┤');
        console.log(`  │  Invoice ID:    ${inv.id.toString().padEnd(47)}│`);
        console.log(`  │  Amount:        ${ethers.formatEther(inv.amount)} ETH`.padEnd(47) + '│');
        console.log(`  │  Payer:         ${inv.payer.padEnd(47)}│`);
        console.log(`  │  Payee:         ${inv.payee.padEnd(47)}│`);
        console.log(`  │  Status:        ${inv.isPaid ? 'PAID ✓' : 'UNPAID ✗'.padEnd(47)}│`);
        console.log(`  │  Created:       ${new Date(Number(inv.createdAt) * 1000).toISOString().padEnd(47)}│`);
        console.log('  └───────────────────────────────────────────────────────────────┘');

        if (!inv.isPaid) {
            console.log('\n  Actions:');
            console.log('    Pay invoice: node scripts/invoice/5_pay.js', invoiceId.toString());
        }

    } catch (err) {
        console.error('\n  ✗ Invoice not found or invalid ID');
        console.error('  Error:', err.message);
    }

    console.log('');
}

main().catch((err) => {
    console.error('\n  ✗ Error:', err.message);
    process.exit(1);
});
