// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract GuildSBT is Ownable {
    enum Tier { Bronze, Silver, Gold }

    struct Group {
        uint256 groupId;
        string name;
        uint256 score;
        Tier tier;
        address[] members;
    }

    mapping(uint256 => Group) public groups;
    mapping(address => uint256) public memberToGroup;
    mapping(address => bool) public authorizedUpdaters;

    constructor() Ownable(msg.sender) {}

    function createGroup(string memory name, address[] memory members) external onlyOwner {
        uint256 groupId = uint256(keccak256(abi.encodePacked(name, block.timestamp)));
        groups[groupId] = Group(groupId, name, 500, Tier.Bronze, members);
        for (uint256 i = 0; i < members.length; i++) {
            memberToGroup[members[i]] = groupId;
        }
    }

    function getGroupTier(uint256 groupId) external view returns (Tier) {
        return groups[groupId].tier;
    }

    function getGroupScore(uint256 groupId) external view returns (uint256) {
        return groups[groupId].score;
    }

    function getGroupMembers(uint256 groupId) external view returns (address[] memory) {
        return groups[groupId].members;
    }

    function updateGroupScore(uint256 groupId, uint256 newScore) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
        groups[groupId].score = newScore;
        if (newScore >= 800) groups[groupId].tier = Tier.Gold;
        else if (newScore >= 600) groups[groupId].tier = Tier.Silver;
        else groups[groupId].tier = Tier.Bronze;
    }

    function recordGroupLoan(uint256 groupId) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
    }

    function recordGroupRepayment(uint256 groupId) external {
        require(authorizedUpdaters[msg.sender], "Not authorized");
    }

    function setAuthorizedUpdater(address updater, bool status) external onlyOwner {
        authorizedUpdaters[updater] = status;
    }
}
