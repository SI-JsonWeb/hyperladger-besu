/**
 * 5_pay.js - Pay an Invoice
 * 
 * Marks an invoice as paid (state-changing transaction - costs gas).
 * Usage: node scripts/invoice/5_pay.js <invoice_id>
 */

const { connectWallet } = require('./utils');

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    PAY INVOICE                                        ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    const { wallet } = await connectWallet();
    const contract = require('./utils').getContract(wallet);

    // Get invoice ID from command line
    const invoiceId = process.argv[2] ? BigInt(process.argv[2]) : null;

    if (!invoiceId) {
        const count = await contract.invoiceCount();
        console.log('\n  Usage: node scripts/invoice/5_pay.js <invoice_id>');
        console.log('  Current invoice count:', count.toString());
        if (count > 0n) {
            console.log('  Example: node scripts/invoice/5_pay.js 1');
        }
        return;
    }

    console.log('\n  Paying invoice ID:', invoiceId.toString());

    try {
        // Get current state
        const invBefore = await contract.getInvoice(invoiceId);
        console.log('  Current status:', invBefore.isPaid ? 'PAID' : 'UNPAID');

        if (invBefore.isPaid) {
            console.log('\n  ✗ Invoice is already paid!');
            return;
        }

        // Send pay transaction
        console.log('\n  Sending payInvoice transaction...');
        const tx = await contract.payInvoice(invoiceId);
        console.log('  TX Hash:', tx.hash);

        const receipt = await tx.wait();

        // Verify updated state
        const invAfter = await contract.getInvoice(invoiceId);

        console.log('\n  ┌───────────────────────────────────────────────────────────────┐');
        console.log('  │                    PAYMENT CONFIRMED                            │');
        console.log('  ├───────────────────────────────────────────────────────────────┤');
        console.log(`  │  Invoice ID:    ${invoiceId.toString().padEnd(47)}│`);
        console.log(`  │  Previous:      ${invBefore.isPaid ? 'PAID' : 'UNPAID'.padEnd(47)}│`);
        console.log(`  │  Current:       PAID ✓`.padEnd(55) + '│');
        console.log(`  │  TX Hash:       ${receipt.hash.slice(0, 40)}...`.padEnd(39) + '│');
        console.log(`  │  Block:         ${receipt.blockNumber.toString().padEnd(47)}│`);
        console.log('  └───────────────────────────────────────────────────────────────┘');

    } catch (err) {
        console.error('\n  ✗ Failed to pay invoice');
        console.error('  Error:', err.message);
    }

    console.log('');
}

main().catch((err) => {
    console.error('\n  ✗ Error:', err.message);
    process.exit(1);
});
