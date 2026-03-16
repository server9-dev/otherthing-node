// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IOTT.sol";

/**
 * @title OTTTreasury
 * @notice Yield-bearing treasury: users buy OTT with USDC at $1, platform fees
 *         increase backing per OTT, users can redeem OTT back to USDC at floor price minus fee.
 * @dev Tracks circulatingTreasuryOTT separately from totalSupply since initial 100M OTT
 *      minted to deployer aren't USDC-backed.
 */
contract OTTTreasury is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IOTT public immutable ottToken;
    IERC20 public immutable usdcToken;

    /// @notice OTT minted via buyOTT (excludes initial deployer supply)
    uint256 public circulatingTreasuryOTT;

    /// @notice Redemption fee in basis points (default 500 = 5%, max 1500 = 15%)
    uint256 public redemptionFeeBps = 500;
    uint256 public constant MAX_REDEMPTION_FEE_BPS = 1500;

    /// @notice Decimal offset: USDC has 6 decimals, OTT has 18 decimals
    uint256 public constant DECIMAL_OFFSET = 1e12;

    // ============ Events ============

    event OTTBought(address indexed buyer, uint256 usdcAmount, uint256 ottAmount);
    event OTTRedeemed(address indexed redeemer, uint256 ottAmount, uint256 usdcAmount);
    event FeesDeposited(address indexed depositor, uint256 usdcAmount);
    event RedemptionFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);

    // ============ Constructor ============

    constructor(address _ottToken, address _usdcToken) Ownable(msg.sender) {
        require(_ottToken != address(0), "OTTTreasury: zero OTT address");
        require(_usdcToken != address(0), "OTTTreasury: zero USDC address");
        ottToken = IOTT(_ottToken);
        usdcToken = IERC20(_usdcToken);
    }

    // ============ External Functions ============

    /**
     * @notice Buy OTT with USDC at $1 each
     * @param usdcAmount Amount of USDC (6 decimals) to spend
     */
    function buyOTT(uint256 usdcAmount) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "OTTTreasury: zero amount");

        // Transfer USDC from buyer to treasury
        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Calculate OTT to mint: 1 USDC = 1 OTT (adjust decimals)
        uint256 ottAmount = usdcAmount * DECIMAL_OFFSET;

        // Mint OTT to buyer (treasury needs minter role)
        ottToken.mint(msg.sender, ottAmount);

        // Track circulating supply
        circulatingTreasuryOTT += ottAmount;

        emit OTTBought(msg.sender, usdcAmount, ottAmount);
    }

    /**
     * @notice Redeem OTT for USDC at floor price minus redemption fee
     * @param ottAmount Amount of OTT (18 decimals) to redeem
     */
    function redeemOTT(uint256 ottAmount) external nonReentrant whenNotPaused {
        require(ottAmount > 0, "OTTTreasury: zero amount");
        require(circulatingTreasuryOTT > 0, "OTTTreasury: no circulating supply");
        require(ottAmount <= circulatingTreasuryOTT, "OTTTreasury: exceeds circulating supply");

        // Calculate gross USDC at floor price (directly in USDC decimals)
        uint256 treasuryUsdc = usdcToken.balanceOf(address(this));
        uint256 grossUsdc = (ottAmount * treasuryUsdc) / circulatingTreasuryOTT;

        // Deduct redemption fee
        uint256 fee = (grossUsdc * redemptionFeeBps) / 10000;
        uint256 netUsdc = grossUsdc - fee;

        require(netUsdc > 0, "OTTTreasury: redeem amount too small");

        // Burn OTT from sender
        ottToken.burnFrom(msg.sender, ottAmount);

        // Decrease circulating supply
        circulatingTreasuryOTT -= ottAmount;

        // Transfer USDC to redeemer (fee stays in treasury, increasing backing for remaining holders)
        usdcToken.safeTransfer(msg.sender, netUsdc);

        emit OTTRedeemed(msg.sender, ottAmount, netUsdc);
    }

    /**
     * @notice Deposit platform fees as USDC, increasing backing per OTT
     * @param usdcAmount Amount of USDC to deposit
     */
    function depositFees(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount > 0, "OTTTreasury: zero amount");

        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);

        emit FeesDeposited(msg.sender, usdcAmount);
    }

    // ============ View Functions ============

    /**
     * @notice Get USDC backing per OTT (18 decimal precision)
     * @return Backing per OTT scaled by 1e18
     */
    function getBackingPerOTT() public view returns (uint256) {
        if (circulatingTreasuryOTT == 0) return 0;

        uint256 treasuryUsdc = usdcToken.balanceOf(address(this));
        // Scale: (usdc * 1e18 * DECIMAL_OFFSET) / circulatingOTT
        // This gives backing in OTT-decimal-adjusted terms
        return (treasuryUsdc * 1e18 * DECIMAL_OFFSET) / circulatingTreasuryOTT;
    }

    /**
     * @notice Preview net USDC received for redeeming ottAmount
     * @param ottAmount Amount of OTT to redeem
     * @return netUsdc Net USDC after fee
     */
    function getRedeemAmount(uint256 ottAmount) external view returns (uint256) {
        if (circulatingTreasuryOTT == 0 || ottAmount == 0) return 0;

        uint256 treasuryUsdc = usdcToken.balanceOf(address(this));
        uint256 grossUsdc = (ottAmount * treasuryUsdc) / circulatingTreasuryOTT;
        uint256 fee = (grossUsdc * redemptionFeeBps) / 10000;
        return grossUsdc - fee;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set redemption fee (max 15%)
     * @param bps Fee in basis points
     */
    function setRedemptionFee(uint256 bps) external onlyOwner {
        require(bps <= MAX_REDEMPTION_FEE_BPS, "OTTTreasury: fee too high");
        uint256 oldFee = redemptionFeeBps;
        redemptionFeeBps = bps;
        emit RedemptionFeeUpdated(oldFee, bps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
