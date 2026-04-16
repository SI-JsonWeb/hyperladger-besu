// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.10;

/**
 * @title InvoiceTutorial
 * @dev A simple smart contract to demonstrate invoice tokenization on a blockchain.
 * 
 * LEARNING CONCEPTS:
 * - State variables persist on the blockchain forever
 * - Structs group related data together
 * - Events allow off-chain applications to listen for on-chain actions (like a newsletter subscription)
 * - Transactions modify state and cost gas; calls only read data and are free
 */
contract InvoiceTutorial {

    // ============================================
    // DATA STRUCTURES
    // ============================================
    
    /**
     * @dev An Invoice represents a tokenized debt.
     * "Tokenized" means we've created a unique, tamper-proof record of this invoice on-chain.
     */
    struct Invoice {
        uint256 id;           // Unique identifier for this invoice token
        uint256 amount;       // Amount owed in wei (smallest ETH unit)
        address payer;        // The party who owes the money
        address payee;        // The party who is owed the money
        bool isPaid;          // Has this invoice been settled?
        uint256 createdAt;    // Timestamp of when the invoice was tokenized
    }

    // ============================================
    // STATE VARIABLES (Stored on Blockchain)
    // ============================================
    
    // This mapping stores all invoice tokens. Key = invoice ID, Value = Invoice struct.
    // In Solidity, mappings are like hash tables - access is O(1).
    mapping(uint256 => Invoice) public invoices;
    
    // Counter to track how many invoices have been created (also serves as next ID)
    uint256 public invoiceCount;

    // ============================================
    // EVENTS (Off-chain listeners)
    // ============================================
    
    /**
     * @dev Events are how smart contracts communicate with the outside world.
     * When an invoice is created, we emit this event. Off-chain apps (like your tutorial script)
     * can listen for these to know when something happened without constantly polling.
     */
    event InvoiceCreated(
        uint256 indexed id,    // "indexed" allows filtering by payer address
        address indexed payer,
        uint256 amount
    );

    event InvoicePaid(uint256 indexed id);

    // ============================================
    // FUNCTIONS
    // ============================================
    
    /**
     * @dev Mints a new invoice token on the blockchain.
     * 
     * LEARNING:
     * - This is a STATE-MODIFYING function, so it requires a transaction.
     * - The transaction will cost gas because it changes blockchain state.
     * - Anyone can call this; in production you'd add access control (only payee can mint for themselves).
     * 
     * @param _amount Amount owed in wei
     * @param _payer Address that owes the money
     */
    function mintInvoice(uint256 _amount, address _payer) public returns (uint256) {
        // Ensure amount is positive
        require(_amount > 0, "Amount must be greater than 0");
        
        // Increment counter to get the new invoice ID
        invoiceCount++;
        
        // Create the new invoice and store it
        invoices[invoiceCount] = Invoice({
            id: invoiceCount,
            amount: _amount,
            payer: _payer,
            payee: msg.sender,  // msg.sender is the person who called this function
            isPaid: false,
            createdAt: block.timestamp  // block.timestamp is the current block's timestamp
        });
        
        // Emit the event so off-chain listeners know about it
        emit InvoiceCreated(invoiceCount, _payer, _amount);
        
        return invoiceCount;
    }

    /**
     * @dev Marks an invoice as paid.
     * 
     * LEARNING:
     * - Only the payer should be able to mark an invoice as paid.
     * - In production, you'd verify msg.sender == invoice.payer.
     * 
     * @param _id The invoice ID to mark as paid
     */
    function payInvoice(uint256 _id) public {
        require(_id > 0 && _id <= invoiceCount, "Invalid invoice ID");
        require(!invoices[_id].isPaid, "Invoice already paid");
        
        invoices[_id].isPaid = true;
        emit InvoicePaid(_id);
    }

    /**
     * @dev Retrieves an invoice by ID.
     * 
     * LEARNING:
     * - This is a VIEW function (no state modifications).
     * - It can be called for FREE via a local "call" - no transaction needed.
     * - The "public" keyword auto-generates a getter for this mapping.
     * 
     * @param _id The invoice ID to retrieve
     * @return The Invoice struct
     */
    function getInvoice(uint256 _id) public view returns (Invoice memory) {
        require(_id > 0 && _id <= invoiceCount, "Invalid invoice ID");
        return invoices[_id];
    }
}
