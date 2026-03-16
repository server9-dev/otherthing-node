import { ethers } from "hardhat";

// Existing deployed contract addresses on Sepolia
const DEPLOYED = {
  OTT: "0x201333A5C882751a98E483f9B763DF4D8e5A1055",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Treasury contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy MockUSDC
  console.log("\n1. Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();
  const mockUsdcAddress = await mockUsdc.getAddress();
  console.log("   MockUSDC deployed to:", mockUsdcAddress);

  // 2. Deploy OTTTreasury
  console.log("\n2. Deploying OTTTreasury...");
  const OTTTreasury = await ethers.getContractFactory("OTTTreasury");
  const treasury = await OTTTreasury.deploy(DEPLOYED.OTT, mockUsdcAddress);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("   OTTTreasury deployed to:", treasuryAddress);

  // 3. Grant treasury minter role on OTT
  console.log("\n3. Granting minter role to treasury...");
  const ott = await ethers.getContractAt("OTT", DEPLOYED.OTT);
  const tx = await ott.addMinter(treasuryAddress);
  await tx.wait();
  console.log("   Treasury added as OTT minter");

  // 4. Seed MockUSDC to deployer for testing
  console.log("\n4. Seeding MockUSDC to deployer...");
  const seedAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  const mintTx = await mockUsdc.mint(deployer.address, seedAmount);
  await mintTx.wait();
  console.log("   Minted 1,000,000 MockUSDC to deployer");

  console.log("\n========================================");
  console.log("Treasury Deployment Complete!");
  console.log("========================================");
  console.log("\nContract Addresses:");
  console.log("  MockUSDC:     ", mockUsdcAddress);
  console.log("  OTTTreasury:  ", treasuryAddress);
  console.log("\nNext steps:");
  console.log("  1. Update CONTRACT_ADDRESSES in web3-service.ts and Web3Context.tsx");
  console.log("  2. Verify contracts on Etherscan");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
