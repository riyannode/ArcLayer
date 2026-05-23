// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title WorkProof
/// @notice Soulbound proof NFT minted when an agent job settles successfully.
contract WorkProof is ERC721URIStorage, Ownable {
    struct ProofRecord {
        uint256 jobId;
        uint256 agentId;
        address payer;
        uint256 amountPaid;
        uint256 mintedAt;
        string metadataURI;
    }

    uint256 private nextTokenId;
    address public minter;

    mapping(uint256 => ProofRecord) public proofs;
    mapping(uint256 => uint256[]) private proofsByAgent;
    mapping(uint256 => uint256) public proofTokenByJobId;

    event MinterUpdated(address indexed minter);
    event WorkProofMinted(
        uint256 indexed tokenId,
        uint256 indexed jobId,
        uint256 indexed agentId,
        address payer,
        uint256 amountPaid
    );

    error Soulbound();

    constructor() ERC721("ArcLayer Work Proof", "ARCWP") Ownable(msg.sender) {}

    modifier onlyMinter() {
        require(msg.sender == minter, "Not minter");
        _;
    }

    function setMinter(address newMinter) external onlyOwner {
        require(newMinter != address(0), "Invalid minter");
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    function mintProof(
        address to,
        uint256 jobId,
        uint256 agentId,
        address payer,
        uint256 amountPaid,
        string calldata metadataURI
    ) external onlyMinter returns (uint256 tokenId) {
        require(to != address(0), "Invalid recipient");
        require(jobId != 0, "Invalid job");
        require(agentId != 0, "Invalid agent");
        require(proofTokenByJobId[jobId] == 0, "Proof exists");

        tokenId = ++nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);

        proofs[tokenId] = ProofRecord({
            jobId: jobId,
            agentId: agentId,
            payer: payer,
            amountPaid: amountPaid,
            mintedAt: block.timestamp,
            metadataURI: metadataURI
        });

        proofsByAgent[agentId].push(tokenId);
        proofTokenByJobId[jobId] = tokenId;

        emit WorkProofMinted(tokenId, jobId, agentId, payer, amountPaid);
    }

    function getProofsByAgent(uint256 agentId) external view returns (uint256[] memory) {
        return proofsByAgent[agentId];
    }

    function getProof(uint256 tokenId) external view returns (ProofRecord memory) {
        return proofs[tokenId];
    }

    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }
}
