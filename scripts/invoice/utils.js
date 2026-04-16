/**
 * Invoice Tokenization - Shared Utilities
 * 
 * This module provides common functions used across all invoice scripts.
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63';
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

// ABI for InvoiceTutorial
const ABI = [
    "function mintInvoice(uint256 _amount, address _payer) returns (uint256)",
    "function payInvoice(uint256 _id)",
    "function getInvoice(uint256 _id) view returns (tuple(uint256 id, uint256 amount, address payer, address payee, bool isPaid, uint256 createdAt))",
    "function invoiceCount() view returns (uint256)",
    "event InvoiceCreated(uint256 indexed id, address indexed payer, uint256 amount)",
    "event InvoicePaid(uint256 indexed id)"
];

/**
 * Connect to the blockchain and return provider + wallet
 */
function connectWallet() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    return { provider, wallet };
}

/**
 * Load existing contract address from config.json
 */
function loadContractAddress() {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error(`Config file not found. Run 1_deploy.js first!\n  Expected: ${CONFIG_PATH}`);
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!config.contractAddress) {
        throw new Error('No contractAddress in config. Run 1_deploy.js first!');
    }
    return config.contractAddress;
}

/**
 * Save contract address to config.json
 */
function saveContractAddress(address, network) {
    const config = {
        contractAddress: address,
        network: network,
        deployedAt: new Date().toISOString()
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`  ✓ Contract address saved to ${CONFIG_PATH}`);
}

/**
 * Get contract instance connected to wallet
 */
function getContract(wallet) {
    const address = loadContractAddress();
    return new ethers.Contract(address, ABI, wallet);
}

/**
 * Load wallet and contract, print info
 */
async function loadWalletAndContract() {
    const { provider, wallet } = connectWallet();
    
    // Verify connection
    const network = await provider.getNetwork();
    const balance = await provider.getBalance(wallet.address);
    
    console.log('\n  Network:', network.name, '(chain ID:', network.chainId + ')');
    console.log('  Wallet:', wallet.address);
    console.log('  Balance:', ethers.formatEther(balance), 'ETH');
    
    return { provider, wallet };
}

module.exports = {
    connectWallet,
    loadContractAddress,
    saveContractAddress,
    getContract,
    loadWalletAndContract,
    ABI,
    CONFIG_PATH
};
