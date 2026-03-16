import { expect } from "chai";
import { ethers } from "hardhat";
import { OTT, MockUSDC, OTTTreasury } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("OTTTreasury", function () {
  let ott: OTT;
  let usdc: MockUSDC;
  let treasury: OTTTreasury;

  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let depositor: SignerWithAddress;

  const USDC_DECIMALS = 6;
  const OTT_DECIMALS = 18;
  const DECIMAL_OFFSET = 10n ** 12n;

  // Helper: parse USDC amount (6 decimals)
  const parseUsdc = (amount: number) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);
  // Helper: parse OTT amount (18 decimals)
  const parseOtt = (amount: number) => ethers.parseUnits(amount.toString(), OTT_DECIMALS);

  beforeEach(async function () {
    [owner, buyer, depositor] = await ethers.getSigners();

    // Deploy OTT
    const OTTFactory = await ethers.getContractFactory("OTT");
    ott = await OTTFactory.deploy();

    // Deploy MockUSDC
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDCFactory.deploy();

    // Deploy OTTTreasury
    const TreasuryFactory = await ethers.getContractFactory("OTTTreasury");
    treasury = await TreasuryFactory.deploy(await ott.getAddress(), await usdc.getAddress());

    // Grant treasury minter role on OTT
    await ott.addMinter(await treasury.getAddress());

    // Mint USDC to test accounts
    await usdc.mint(buyer.address, parseUsdc(100000)); // 100k USDC
    await usdc.mint(depositor.address, parseUsdc(100000));
  });

  describe("buyOTT", function () {
    it("Should buy OTT with USDC at $1 each", async function () {
      const usdcAmount = parseUsdc(100); // 100 USDC

      await usdc.connect(buyer).approve(await treasury.getAddress(), usdcAmount);
      await expect(
        treasury.connect(buyer).buyOTT(usdcAmount)
      ).to.emit(treasury, "OTTBought")
        .withArgs(buyer.address, usdcAmount, parseOtt(100));

      // Buyer should have 100 OTT
      expect(await ott.balanceOf(buyer.address)).to.equal(parseOtt(100));

      // Treasury should have 100 USDC
      expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(usdcAmount);

      // Circulating treasury OTT should be 100
      expect(await treasury.circulatingTreasuryOTT()).to.equal(parseOtt(100));
    });

    it("Should enforce 1 USDC = exactly 1 OTT decimal accuracy", async function () {
      // 1 USDC = 1_000_000 (6 dec) should produce 1 OTT = 1_000_000_000_000_000_000 (18 dec)
      const oneUsdc = parseUsdc(1);
      await usdc.connect(buyer).approve(await treasury.getAddress(), oneUsdc);
      await treasury.connect(buyer).buyOTT(oneUsdc);

      expect(await ott.balanceOf(buyer.address)).to.equal(parseOtt(1));
    });

    it("Should reject zero amount", async function () {
      await expect(
        treasury.connect(buyer).buyOTT(0)
      ).to.be.revertedWith("OTTTreasury: zero amount");
    });

    it("Should reject when paused", async function () {
      await treasury.pause();
      const amount = parseUsdc(100);
      await usdc.connect(buyer).approve(await treasury.getAddress(), amount);
      await expect(
        treasury.connect(buyer).buyOTT(amount)
      ).to.be.revertedWithCustomError(treasury, "EnforcedPause");
    });
  });

  describe("depositFees", function () {
    it("Should deposit fees and increase backing per OTT", async function () {
      // First, buyer buys 100 OTT
      const buyAmount = parseUsdc(100);
      await usdc.connect(buyer).approve(await treasury.getAddress(), buyAmount);
      await treasury.connect(buyer).buyOTT(buyAmount);

      // Backing should be $1/OTT
      const backingBefore = await treasury.getBackingPerOTT();
      expect(backingBefore).to.equal(ethers.parseEther("1")); // 1e18

      // Deposit 100 USDC in fees
      const feeAmount = parseUsdc(100);
      await usdc.connect(depositor).approve(await treasury.getAddress(), feeAmount);
      await expect(
        treasury.connect(depositor).depositFees(feeAmount)
      ).to.emit(treasury, "FeesDeposited")
        .withArgs(depositor.address, feeAmount);

      // Backing should now be $2/OTT (200 USDC / 100 OTT)
      const backingAfter = await treasury.getBackingPerOTT();
      expect(backingAfter).to.equal(ethers.parseEther("2"));
    });

    it("Should reject zero amount", async function () {
      await expect(
        treasury.connect(depositor).depositFees(0)
      ).to.be.revertedWith("OTTTreasury: zero amount");
    });
  });

  describe("redeemOTT", function () {
    beforeEach(async function () {
      // Buyer buys 100 OTT
      const buyAmount = parseUsdc(100);
      await usdc.connect(buyer).approve(await treasury.getAddress(), buyAmount);
      await treasury.connect(buyer).buyOTT(buyAmount);
    });

    it("Should redeem OTT for USDC minus fee", async function () {
      const redeemAmount = parseOtt(10); // Redeem 10 OTT

      // Approve OTT for burning
      await ott.connect(buyer).approve(await treasury.getAddress(), redeemAmount);

      const buyerUsdcBefore = await usdc.balanceOf(buyer.address);

      await expect(
        treasury.connect(buyer).redeemOTT(redeemAmount)
      ).to.emit(treasury, "OTTRedeemed");

      const buyerUsdcAfter = await usdc.balanceOf(buyer.address);
      const received = buyerUsdcAfter - buyerUsdcBefore;

      // At $1 backing, 10 OTT = $10 gross, minus 5% fee = $9.50
      expect(received).to.equal(parseUsdc(9.5));

      // OTT should be burned
      expect(await ott.balanceOf(buyer.address)).to.equal(parseOtt(90));

      // Circulating supply should decrease
      expect(await treasury.circulatingTreasuryOTT()).to.equal(parseOtt(90));
    });

    it("Should redeem at higher backing after fees deposited", async function () {
      // Deposit 100 USDC fees → backing = $2/OTT
      const feeAmount = parseUsdc(100);
      await usdc.connect(depositor).approve(await treasury.getAddress(), feeAmount);
      await treasury.connect(depositor).depositFees(feeAmount);

      // Redeem 1 OTT: gross = $2, fee = $0.10, net = $1.90
      const redeemAmount = parseOtt(1);
      await ott.connect(buyer).approve(await treasury.getAddress(), redeemAmount);

      const buyerUsdcBefore = await usdc.balanceOf(buyer.address);
      await treasury.connect(buyer).redeemOTT(redeemAmount);
      const buyerUsdcAfter = await usdc.balanceOf(buyer.address);

      expect(buyerUsdcAfter - buyerUsdcBefore).to.equal(parseUsdc(1.9));
    });

    it("After $100 fees on 100 OTT: backing=$2, redeem 10 OTT ~= $19 USDC", async function () {
      // Deposit $100 fees
      const feeAmount = parseUsdc(100);
      await usdc.connect(depositor).approve(await treasury.getAddress(), feeAmount);
      await treasury.connect(depositor).depositFees(feeAmount);

      // backing = 200 USDC / 100 OTT = $2/OTT
      expect(await treasury.getBackingPerOTT()).to.equal(ethers.parseEther("2"));

      // Redeem 10 OTT: gross = 10 * $2 = $20, fee = $1 (5%), net = $19
      const redeemAmount = parseOtt(10);
      await ott.connect(buyer).approve(await treasury.getAddress(), redeemAmount);

      const buyerUsdcBefore = await usdc.balanceOf(buyer.address);
      await treasury.connect(buyer).redeemOTT(redeemAmount);
      const buyerUsdcAfter = await usdc.balanceOf(buyer.address);

      expect(buyerUsdcAfter - buyerUsdcBefore).to.equal(parseUsdc(19));
    });

    it("Should reject zero amount", async function () {
      await expect(
        treasury.connect(buyer).redeemOTT(0)
      ).to.be.revertedWith("OTTTreasury: zero amount");
    });

    it("Should reject when no circulating supply", async function () {
      // Redeem all
      const all = parseOtt(100);
      await ott.connect(buyer).approve(await treasury.getAddress(), all);
      await treasury.connect(buyer).redeemOTT(all);

      // Try again
      await expect(
        treasury.connect(buyer).redeemOTT(parseOtt(1))
      ).to.be.revertedWith("OTTTreasury: no circulating supply");
    });

    it("Should reject when paused", async function () {
      await treasury.pause();
      const amount = parseOtt(10);
      await ott.connect(buyer).approve(await treasury.getAddress(), amount);
      await expect(
        treasury.connect(buyer).redeemOTT(amount)
      ).to.be.revertedWithCustomError(treasury, "EnforcedPause");
    });
  });

  describe("getBackingPerOTT", function () {
    it("Should return 0 when no circulating supply", async function () {
      expect(await treasury.getBackingPerOTT()).to.equal(0);
    });

    it("Should return 1e18 when 1:1 backing", async function () {
      const amount = parseUsdc(100);
      await usdc.connect(buyer).approve(await treasury.getAddress(), amount);
      await treasury.connect(buyer).buyOTT(amount);

      expect(await treasury.getBackingPerOTT()).to.equal(ethers.parseEther("1"));
    });
  });

  describe("getRedeemAmount", function () {
    it("Should preview correct redeem amount", async function () {
      // Buy 100 OTT, deposit 100 USDC fees
      const buyAmount = parseUsdc(100);
      await usdc.connect(buyer).approve(await treasury.getAddress(), buyAmount);
      await treasury.connect(buyer).buyOTT(buyAmount);

      const feeAmount = parseUsdc(100);
      await usdc.connect(depositor).approve(await treasury.getAddress(), feeAmount);
      await treasury.connect(depositor).depositFees(feeAmount);

      // Preview: redeem 10 OTT at $2 backing, 5% fee → $19 USDC
      const preview = await treasury.getRedeemAmount(parseOtt(10));
      expect(preview).to.equal(parseUsdc(19));
    });

    it("Should return 0 for zero input", async function () {
      expect(await treasury.getRedeemAmount(0)).to.equal(0);
    });
  });

  describe("setRedemptionFee", function () {
    it("Should allow owner to change fee", async function () {
      await expect(
        treasury.setRedemptionFee(1000)
      ).to.emit(treasury, "RedemptionFeeUpdated")
        .withArgs(500, 1000);

      expect(await treasury.redemptionFeeBps()).to.equal(1000);
    });

    it("Should reject fee above max", async function () {
      await expect(
        treasury.setRedemptionFee(1501)
      ).to.be.revertedWith("OTTTreasury: fee too high");
    });

    it("Should reject non-owner", async function () {
      await expect(
        treasury.connect(buyer).setRedemptionFee(1000)
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
  });

  describe("pause/unpause", function () {
    it("Should only allow owner to pause", async function () {
      await expect(
        treasury.connect(buyer).pause()
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });

    it("Should allow operations after unpause", async function () {
      await treasury.pause();
      await treasury.unpause();

      const amount = parseUsdc(100);
      await usdc.connect(buyer).approve(await treasury.getAddress(), amount);
      await expect(treasury.connect(buyer).buyOTT(amount)).to.not.be.reverted;
    });
  });
});
