// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MarketMirrorRegistry
/// @notice Maps Polymarket slugs to Ignia market ids and tracks resolution.
contract MarketMirrorRegistry is Ownable {
    struct Mirror {
        bytes32 slugHash;
        string slug;
        string asset;            // BTC, ETH, SOL
        uint256 igniaMarketId;
        uint64 createdAt;
        uint64 deadline;
        bool resolved;
        uint8 outcome;           // 0 = unresolved, 1 = YES, 2 = NO
    }

    mapping(bytes32 => Mirror) private mirrors;
    bytes32[] private allSlugs;
    mapping(address => bool) public authorizedMirrors;

    event MirrorRegistered(
        bytes32 indexed slugHash,
        string slug,
        string asset,
        uint256 indexed igniaMarketId,
        uint64 deadline
    );
    event MirrorResolved(bytes32 indexed slugHash, uint8 outcome);
    event MirrorAuthorized(address indexed mirror);
    event MirrorRevoked(address indexed mirror);

    error MirrorExists();
    error MirrorMissing();
    error AlreadyResolved();
    error NotAuthorized();
    error InvalidOutcome();

    modifier onlyAuthorized() {
        if (!authorizedMirrors[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedMirrors[msg.sender] = true;
    }

    function authorizeMirror(address mirror) external onlyOwner {
        authorizedMirrors[mirror] = true;
        emit MirrorAuthorized(mirror);
    }

    function revokeMirror(address mirror) external onlyOwner {
        authorizedMirrors[mirror] = false;
        emit MirrorRevoked(mirror);
    }

    function registerMirror(
        string calldata slug,
        string calldata asset,
        uint256 igniaMarketId,
        uint64 deadline
    ) external onlyAuthorized returns (bytes32 slugHash) {
        slugHash = keccak256(bytes(slug));
        if (mirrors[slugHash].createdAt != 0) revert MirrorExists();

        mirrors[slugHash] = Mirror({
            slugHash: slugHash,
            slug: slug,
            asset: asset,
            igniaMarketId: igniaMarketId,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            resolved: false,
            outcome: 0
        });
        allSlugs.push(slugHash);

        emit MirrorRegistered(slugHash, slug, asset, igniaMarketId, deadline);
    }

    function markResolved(bytes32 slugHash, uint8 outcome) external onlyAuthorized {
        Mirror storage m = mirrors[slugHash];
        if (m.createdAt == 0) revert MirrorMissing();
        if (m.resolved) revert AlreadyResolved();
        if (outcome != 1 && outcome != 2) revert InvalidOutcome();

        m.resolved = true;
        m.outcome = outcome;

        emit MirrorResolved(slugHash, outcome);
    }

    function getMirror(bytes32 slugHash) external view returns (Mirror memory) {
        return mirrors[slugHash];
    }

    function getMirrorBySlug(string calldata slug) external view returns (Mirror memory) {
        return mirrors[keccak256(bytes(slug))];
    }

    function mirrorExists(bytes32 slugHash) external view returns (bool) {
        return mirrors[slugHash].createdAt != 0;
    }

    function getAllSlugs() external view returns (bytes32[] memory) {
        return allSlugs;
    }

    function totalMirrors() external view returns (uint256) {
        return allSlugs.length;
    }
}
