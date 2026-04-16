/**
 * 3_list.js - List All Invoices
 * 
 * Reads all invoices from the blockchain (view/call - free).
 */

const { connectWallet } = require('./utils');
const ethers = require('ethers');

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    LIST ALL INVOICES                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    const { wallet } = await connectWallet();
    const contract = require('./utils').getContract(wallet);

    const count = await contract.invoiceCount();
    console.log('\n  Total Invoices: ' + count);

    if (count === 0n) {
        console.log('\n  No invoices found. Create one first:');
        console.log('    node scripts/invoice/2_create.js\n');
        return;
    }

    console.log('\n  ┌─────┬────────────┬───────────────┬──────────┬────────┬──────────┐');
    console.log('  │ ID  │ Amount     │ Payer         │ Payee    │ Paid?  │ Created  │');
    console.log('  ├─────┼────────────┼───────────────┼──────────┼────────┼──────────┤');

    for (let i = 1n; i <= count; i++) {
        const inv = await contract.getInvoice(i);
        const amountEth = ethers.formatEther(inv.amount);
        const created = new Date(Number(inv.createdAt) * 1000).toISOString().split('T')[0];
        const paid = inv.isPaid ? '✓' : '✗';
        
        console.log(
            '  │' + inv.id.toString().padStart(4).padEnd(5) +
            '│' + amountEth.padStart(10).padEnd(12) +
            '│' + inv.payer.slice(0, 14).padEnd(15) +
            '│' + inv.payee.slice(0, 10).padEnd(10) +
            '│' + paid.padStart(7).padEnd(8) +
            '│' + created.padEnd(10) + '│'
        );
    }

    console.log('  └─────┴────────────┴───────────────┴──────────┴────────┴──────────┘');
    console.log('\n  View details: node scripts/invoice/4_read.js <id>');
    console.log('  Pay invoice:   node scripts/invoice/5_pay.js <id>\n');
}

main().catch((err) => {
    console.error('\n  ✗ Error:', err.message);
    process.exit(1);
});
