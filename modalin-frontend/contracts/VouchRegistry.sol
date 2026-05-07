// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VouchRegistry is Ownable {
    struct Vouch {
        address voucher;
        uint256 amount;
    }

    mapping(address => Vouch[]) public vouches;
    address public loanEscrow;

    constructor() Ownable(msg.sender) {}

    function vouch(address borrower) external payable {
        vouches[borrower].push(Vouch(msg.sender, msg.value));
    }

    function getVouchScore(address borrower) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < vouches[borrower].length; i++) {
            total += vouches[borrower][i].amount;
        }
        // Simplified score: 1 ETH = 100 points, max 1000
        uint256 score = (total * 100) / 1 ether;
        return score > 1000 ? 1000 : score;
    }

    function slashVouchers(address borrower) external {
        require(msg.sender == loanEscrow, "Only escrow can slash");
        delete vouches[borrower];
    }

    function setLoanEscrow(address _loanEscrow) external onlyOwner {
        loanEscrow = _loanEscrow;
    }
}
