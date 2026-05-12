// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Achievement - Soulbound Badge NFT
/// @notice Non-transferable NFT badges for on-chain achievements on Arc Network
contract Achievement is ERC721, ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;

    enum BadgeType {
        FirstTransaction,
        BridgeUSDC,
        DeployContract,
        ReferFriends,
        CompleteInvoice
    }

    struct Badge {
        BadgeType badgeType;
        uint256 mintedAt;
        string metadataURI;
    }

    mapping(uint256 => Badge) public badges;
    mapping(address => mapping(BadgeType => bool)) public hasBadge;
    mapping(address => uint256[]) public userBadges;

    event BadgeMinted(address indexed to, BadgeType badgeType, uint256 tokenId);

    constructor() ERC721("ArcLayer Achievement", "ARCWRK") Ownable(msg.sender) {}

    /// @notice Mint a soulbound badge for an achievement
    function mintBadge(
        address to,
        BadgeType badgeType,
        string memory metadataURI
    ) external onlyOwner returns (uint256) {
        require(!hasBadge[to][badgeType], "Already has this badge");

        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);

        badges[tokenId] = Badge({
            badgeType: badgeType,
            mintedAt: block.timestamp,
            metadataURI: metadataURI
        });

        hasBadge[to][badgeType] = true;
        userBadges[to].push(tokenId);

        emit BadgeMinted(to, badgeType, tokenId);
        return tokenId;
    }

    /// @notice Get all badge token IDs for a user
    function getUserBadges(address user) external view returns (uint256[] memory) {
        return userBadges[user];
    }

    /// @notice Get badge details by token ID
    function getBadge(uint256 tokenId) external view returns (Badge memory) {
        return badges[tokenId];
    }

    // Required overrides for ERC721 + ERC721URIStorage
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
