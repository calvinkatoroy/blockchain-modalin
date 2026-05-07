// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SoulboundToken is ERC721, Ownable {
    struct CreditProfile {
        uint256 reputationScore;
        uint256 totalLoans;
        uint256 totalRepaid;
        uint256 lastUpdated;
    }

    mapping(address => CreditProfile) public profiles;
    mapping(address => bool) public authorizedUpdaters;

    constructor() ERC721("ModalIn Soulbound Token", "MSBT") Ownable(msg.sender) {}

    function mint(address to) external onlyOwner {
        _safeMint(to, uint256(uint160(to)));
        profiles[to] = CreditProfile(500, 0, 0, block.timestamp);
    }

    function hasSBT(address user) external view returns (bool) {
        return balanceOf(user) > 0;
    }

    function getReputationScore(address user) external view returns (uint256) {
        return profiles[user].reputationScore;
    }

    function getRepaymentRate(address user) external view returns (uint256) {
        if (profiles[user].totalLoans == 0) return 100;
        return (profiles[user].totalRepaid * 100) / profiles[user].totalLoans;
    }

    function getProfile(address user) external view returns (CreditProfile memory) {
        return profiles[user];
    }

    function updateReputation(address user, uint256 newScore) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
        profiles[user].reputationScore = newScore;
        profiles[user].lastUpdated = block.timestamp;
    }

    function recordLoan(address user, uint256 amount) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
        profiles[user].totalLoans += amount;
    }

    function recordRepayment(address user, uint256 amount) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
        profiles[user].totalRepaid += amount;
    }

    function setAuthorizedUpdater(address updater, bool status) external onlyOwner {
        authorizedUpdaters[updater] = status;
    }

    // Soulbound logic: override transfer functions to revert
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("SBT: Transfer not allowed");
        }
        return super._update(to, tokenId, auth);
    }
}
