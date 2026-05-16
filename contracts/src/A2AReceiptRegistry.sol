// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title A2AReceiptRegistry
/// @notice Anchors signed A2A receipts on-chain. Provider signs EIP-712 over the
///         (request, response, payment, trade) tuple. Verifies signature, prevents
///         replay, and emits an audit trail.
contract A2AReceiptRegistry is Ownable, EIP712 {
    using ECDSA for bytes32;

    enum Rail {
        ARC_NATIVE,
        CIRCLE_GATEWAY
    }

    struct Receipt {
        bytes32 providerAgentId;
        bytes32 buyerAgentId;
        bytes32 receiptHash;
        bytes32 requestHash;
        bytes32 responseHash;
        bytes32 signalHash;
        uint128 amount;
        uint64 timestamp;
        Rail rail;
        bytes32 paymentRef;     // Arc tx hash OR Gateway payment id
        bytes32 tradeTx;
        address provider;       // Provider EOA that signed
        bool exists;
    }

    bytes32 private constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(bytes32 providerAgentId,bytes32 buyerAgentId,uint128 amount,bytes32 paymentRef,bytes32 requestHash,bytes32 responseHash,bytes32 signalHash,uint64 timestamp)"
    );

    mapping(bytes32 => Receipt) private receipts;
    mapping(bytes32 => bytes32[]) private agentReceipts;

    event ReceiptAnchored(
        bytes32 indexed receiptHash,
        bytes32 indexed providerAgentId,
        bytes32 indexed buyerAgentId,
        uint128 amount,
        Rail rail
    );

    error AlreadyAnchored();
    error InvalidSignature();
    error MissingProvider();

    constructor() Ownable(msg.sender) EIP712("ArcLayerA2AReceipt", "1") {}

    function anchorReceipt(Receipt calldata r, bytes calldata providerSig) external {
        if (receipts[r.receiptHash].exists) revert AlreadyAnchored();
        if (r.provider == address(0)) revert MissingProvider();

        // Verify provider signed the receipt
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIPT_TYPEHASH,
                r.providerAgentId,
                r.buyerAgentId,
                r.amount,
                r.paymentRef,
                r.requestHash,
                r.responseHash,
                r.signalHash,
                r.timestamp
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(providerSig);
        if (recovered != r.provider) revert InvalidSignature();

        Receipt storage stored = receipts[r.receiptHash];
        stored.providerAgentId = r.providerAgentId;
        stored.buyerAgentId = r.buyerAgentId;
        stored.receiptHash = r.receiptHash;
        stored.requestHash = r.requestHash;
        stored.responseHash = r.responseHash;
        stored.signalHash = r.signalHash;
        stored.amount = r.amount;
        stored.timestamp = r.timestamp;
        stored.rail = r.rail;
        stored.paymentRef = r.paymentRef;
        stored.tradeTx = r.tradeTx;
        stored.provider = r.provider;
        stored.exists = true;

        agentReceipts[r.providerAgentId].push(r.receiptHash);
        agentReceipts[r.buyerAgentId].push(r.receiptHash);

        emit ReceiptAnchored(r.receiptHash, r.providerAgentId, r.buyerAgentId, r.amount, r.rail);
    }

    function getReceipt(bytes32 receiptHash) external view returns (Receipt memory) {
        return receipts[receiptHash];
    }

    function isAnchored(bytes32 receiptHash) external view returns (bool) {
        return receipts[receiptHash].exists;
    }

    function getReceiptsByAgent(bytes32 agentId) external view returns (bytes32[] memory) {
        return agentReceipts[agentId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
