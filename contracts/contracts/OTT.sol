// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OTT Token
 * @notice ERC20 token for the OtherThing distributed compute network
 * @dev Used for node staking, task payments, and rewards
 */
contract OTT is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens

    // Minter role for reward distribution
    mapping(address => bool) public minters;

    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);

    constructor() ERC20("OtherThing Token", "OTT") Ownable(msg.sender) {
        // Mint initial supply to deployer (10% for initial distribution)
        _mint(msg.sender, 100_000_000 * 10**18);
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "OTT: caller is not a minter");
        _;
    }

    /**
     * @notice Add a minter (e.g., NodeRegistry for rewards)
     */
    function addMinter(address account) external onlyOwner {
        minters[account] = true;
        emit MinterAdded(account);
    }

    /**
     * @notice Remove a minter
     */
    function removeMinter(address account) external onlyOwner {
        minters[account] = false;
        emit MinterRemoved(account);
    }

    /**
     * @notice Mint tokens for rewards (capped at MAX_SUPPLY)
     */
    function mint(address to, uint256 amount) external onlyMinter {
        require(totalSupply() + amount <= MAX_SUPPLY, "OTT: max supply exceeded");
        _mint(to, amount);
    }
}
