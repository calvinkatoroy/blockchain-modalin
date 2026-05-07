// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
import "./SoulboundToken.sol";
import "./GuildSBT.sol";

contract InterestRateModel is Ownable {
    SoulboundToken public soulboundToken;
    GuildSBT public guildSBT;

    uint256 public baseRate = 1200;
    uint256 public bronzeRiskPremium = 800;
    uint256 public silverRiskPremium = 400;
    uint256 public goldRiskPremium = 0;
    uint256 public maxReputationDiscount = 600;
    uint256 public maxAPR = 3600;
    uint256 public minAPR = 600;

    event RatesUpdated(uint256 baseRate, uint256 maxAPR, uint256 minAPR);
    event PremiumsUpdated(uint256 bronze, uint256 silver, uint256 gold);

    constructor(address _soulboundToken, address _guildSBT) Ownable(msg.sender) {
        soulboundToken = SoulboundToken(_soulboundToken);
        guildSBT = GuildSBT(_guildSBT);
    }

    function calculateAPR(address borrower) external view returns (uint256 apr) {
        uint256 reputationScore = soulboundToken.getReputationScore(borrower);
        uint256 groupRiskPremium = _getGroupRiskPremium(borrower);
        uint256 reputationDiscount = _getReputationDiscount(reputationScore);
        uint256 rawAPR = baseRate + groupRiskPremium;
        apr = rawAPR > reputationDiscount ? rawAPR - reputationDiscount : minAPR;
        if (apr < minAPR) apr = minAPR;
        if (apr > maxAPR) apr = maxAPR;
    }

    function calculateInterest(
        address borrower,
        uint256 principal,
        uint256 durationDays
    ) external view returns (uint256 interest) {
        uint256 apr = this.calculateAPR(borrower);
        interest = (principal * apr * durationDays) / (365 * 10000);
    }

    function getAPRBreakdown(address borrower) external view returns (
        uint256 base,
        uint256 groupPremium,
        uint256 reputationDiscount,
        uint256 finalAPR
    ) {
        uint256 reputationScore = soulboundToken.getReputationScore(borrower);
        base = baseRate;
        groupPremium = _getGroupRiskPremium(borrower);
        reputationDiscount = _getReputationDiscount(reputationScore);
        uint256 raw = base + groupPremium;
        finalAPR = raw > reputationDiscount ? raw - reputationDiscount : minAPR;
        if (finalAPR < minAPR) finalAPR = minAPR;
        if (finalAPR > maxAPR) finalAPR = maxAPR;
    }

    function _getGroupRiskPremium(address borrower) internal view returns (uint256) {
        uint256 groupId = guildSBT.memberToGroup(borrower);
        if (groupId == 0) return bronzeRiskPremium; 
        GuildSBT.Tier tier = guildSBT.getGroupTier(groupId);
        if (tier == GuildSBT.Tier.Gold) return goldRiskPremium;
        if (tier == GuildSBT.Tier.Silver) return silverRiskPremium;
        return bronzeRiskPremium;
    }

    function _getReputationDiscount(uint256 score) internal view returns (uint256) {
        return (score * maxReputationDiscount) / 1000;
    }

    function setBaseRate(uint256 _baseRate) external onlyOwner {
        baseRate = _baseRate;
        emit RatesUpdated(_baseRate, maxAPR, minAPR);
    }

    function setAPRBounds(uint256 _minAPR, uint256 _maxAPR) external onlyOwner {
        require(_minAPR < _maxAPR, "Min must be less than max");
        minAPR = _minAPR;
        maxAPR = _maxAPR;
        emit RatesUpdated(baseRate, _maxAPR, _minAPR);
    }

    function setRiskPremiums(uint256 _bronze, uint256 _silver, uint256 _gold) external onlyOwner {
        bronzeRiskPremium = _bronze;
        silverRiskPremium = _silver;
        goldRiskPremium = _gold;
        emit PremiumsUpdated(_bronze, _silver, _gold);
    }

    function setMaxReputationDiscount(uint256 _maxDiscount) external onlyOwner {
        maxReputationDiscount = _maxDiscount;
    }
}
