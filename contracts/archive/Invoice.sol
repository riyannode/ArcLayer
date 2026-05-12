// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Invoice - USDC Invoice + Escrow on Arc Network
/// @notice Create, pay, and complete invoices with USDC payments
contract Invoice is Ownable {
    IERC20 public immutable usdc;

    uint256 public platformFeeBps = 50; // 0.5% = 50 basis points
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public invoiceCounter;

    enum Status { Pending, Paid, Completed, Cancelled }

    struct InvoiceData {
        uint256 id;
        address creator;
        address client;
        uint256 amount;          // in USDC (6 decimals)
        string description;
        Status status;
        uint256 createdAt;
        uint256 paidAt;
    }

    mapping(uint256 => InvoiceData) public invoices;

    event InvoiceCreated(uint256 indexed id, address indexed creator, address indexed client, uint256 amount);
    event InvoicePaid(uint256 indexed id, address indexed client, uint256 amount);
    event InvoiceCompleted(uint256 indexed id, uint256 amount);
    event InvoiceCancelled(uint256 indexed id);

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    /// @notice Create a new invoice
    function createInvoice(
        address client,
        uint256 amount,
        string calldata description
    ) external returns (uint256) {
        require(client != address(0), "Invalid client");
        require(amount > 0, "Amount must be > 0");

        uint256 id = invoiceCounter++;
        invoices[id] = InvoiceData({
            id: id,
            creator: msg.sender,
            client: client,
            amount: amount,
            description: description,
            status: Status.Pending,
            createdAt: block.timestamp,
            paidAt: 0
        });

        emit InvoiceCreated(id, msg.sender, client, amount);
        return id;
    }

    /// @notice Pay an invoice (client pays USDC into escrow)
    function payInvoice(uint256 id) external {
        InvoiceData storage inv = invoices[id];
        require(inv.client == msg.sender, "Not the client");
        require(inv.status == Status.Pending, "Not pending");

        // Transfer USDC from client to this contract (escrow)
        require(usdc.transferFrom(msg.sender, address(this), inv.amount), "USDC transfer failed");

        inv.status = Status.Paid;
        inv.paidAt = block.timestamp;

        emit InvoicePaid(id, msg.sender, inv.amount);
    }

    /// @notice Complete invoice and release funds to creator (minus fee)
    function completeInvoice(uint256 id) external {
        InvoiceData storage inv = invoices[id];
        require(inv.creator == msg.sender || msg.sender == owner(), "Not authorized");
        require(inv.status == Status.Paid, "Not paid");

        uint256 fee = (inv.amount * platformFeeBps) / BPS_DENOMINATOR;
        uint256 payout = inv.amount - fee;

        // Transfer payout to creator
        require(usdc.transfer(inv.creator, payout), "Payout failed");
        // Transfer fee to platform owner
        if (fee > 0) {
            require(usdc.transfer(owner(), fee), "Fee transfer failed");
        }

        inv.status = Status.Completed;
        emit InvoiceCompleted(id, payout);
    }

    /// @notice Cancel a pending invoice
    function cancelInvoice(uint256 id) external {
        InvoiceData storage inv = invoices[id];
        require(inv.creator == msg.sender, "Not the creator");
        require(inv.status == Status.Pending, "Not pending");

        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    /// @notice Get all invoices for a user (as creator or client)
    function getUserInvoices(address user) external view returns (InvoiceData[] memory) {
        uint256 count;
        for (uint256 i = 0; i < invoiceCounter; i++) {
            if (invoices[i].creator == user || invoices[i].client == user) count++;
        }

        InvoiceData[] memory result = new InvoiceData[](count);
        uint256 idx;
        for (uint256 i = 0; i < invoiceCounter; i++) {
            if (invoices[i].creator == user || invoices[i].client == user) {
                result[idx++] = invoices[i];
            }
        }
        return result;
    }

    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "Fee too high"); // max 5%
        platformFeeBps = _feeBps;
    }
}
