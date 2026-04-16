/**
 * 1_deploy.js - Deploy InvoiceTutorial Contract
 * 
 * Run this ONCE to deploy the smart contract to the blockchain.
 * The contract address will be saved for other scripts to use.
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const { connectWallet, saveContractAddress } = require('./utils');

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    DEPLOY CONTRACT                                   ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    // Load wallet
    const { provider, wallet } = connectWallet();
    console.log('\n  Deploying from wallet:', wallet.address);

    // Read compiled contract
    const contractPath = path.resolve(__dirname, '../../contracts/InvoiceTutorial.json');
    if (!fs.existsSync(contractPath)) {
        console.error('  ✗ InvoiceTutorial.json not found!');
        console.error('    Run: npm run compile');
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const bytecode = artifact.evm.bytecode.object;
    const abi = artifact.abi;

    // Create factory and deploy
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    console.log('\n  Deploying InvoiceTutorial contract...');
    console.log('  (This costs gas - waiting for mining...)');

    const contract = await factory.deploy();
    const deploymentReceipt = await contract.waitForDeployment();

    const address = await contract.getAddress();
    const network = await provider.getNetwork();

    // Get the actual transaction receipt
    const deployTx = contract.deploymentTransaction();
    const receipt = await deployTx.wait();

    // Save address
    saveContractAddress(address, network.name);

    console.log('\n  ┌───────────────────────────────────────────────────────────────┐');
    console.log('  │                    DEPLOYMENT SUCCESS                        │');
    console.log('  ├───────────────────────────────────────────────────────────────┤');
    console.log(`  │  Contract Address: ${address.padEnd(35)}│`);
    console.log(`  │  Network:          ${network.name.padEnd(35)}│`);
    console.log(`  │  Block Number:      ${receipt.blockNumber.toString().padEnd(35)}│`);
    console.log(`  │  Gas Used:          ${receipt.gasUsed.toString().padEnd(35)}│`);
    console.log(`  │  Transaction Hash:  ${receipt.hash.padEnd(35)}│`);
    console.log('  └───────────────────────────────────────────────────────────────┘');
    console.log('\n  Next step: node scripts/invoice/2_create.js\n');
}

main().catch((err) => {
    console.error('\n  ✗ Error:', err.message);
    process.exit(1);
});
