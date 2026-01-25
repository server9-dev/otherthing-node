import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy OTT Token
  console.log("\n1. Deploying OTT Token...");
  const OTT = await ethers.getContractFactory("OTT");
  const ott = await OTT.deploy();
  await ott.waitForDeployment();
  const ottAddress = await ott.getAddress();
  console.log("   OTT deployed to:", ottAddress);

  // Deploy NodeRegistry
  console.log("\n2. Deploying NodeRegistry...");
  const NodeRegistry = await ethers.getContractFactory("NodeRegistry");
  const nodeRegistry = await NodeRegistry.deploy(ottAddress);
  await nodeRegistry.waitForDeployment();
  const nodeRegistryAddress = await nodeRegistry.getAddress();
  console.log("   NodeRegistry deployed to:", nodeRegistryAddress);

  // Deploy TaskEscrow
  console.log("\n3. Deploying TaskEscrow...");
  const TaskEscrow = await ethers.getContractFactory("TaskEscrow");
  const taskEscrow = await TaskEscrow.deploy(ottAddress, deployer.address);
  await taskEscrow.waitForDeployment();
  const taskEscrowAddress = await taskEscrow.getAddress();
  console.log("   TaskEscrow deployed to:", taskEscrowAddress);

  // Setup permissions
  console.log("\n4. Setting up permissions...");

  // Add NodeRegistry as OTT minter (for rewards)
  await ott.addMinter(nodeRegistryAddress);
  console.log("   Added NodeRegistry as OTT minter");

  // Fund NodeRegistry with OTT for rewards (10M tokens)
  const rewardFund = ethers.parseEther("10000000");
  await ott.transfer(nodeRegistryAddress, rewardFund);
  console.log("   Funded NodeRegistry with 10M OTT for rewards");

  console.log("\n========================================");
  console.log("Deployment complete!");
  console.log("========================================");
  console.log("\nContract Addresses:");
  console.log("  OTT Token:     ", ottAddress);
  console.log("  NodeRegistry:  ", nodeRegistryAddress);
  console.log("  TaskEscrow:    ", taskEscrowAddress);
  console.log("\nDeployer OTT Balance:", ethers.formatEther(await ott.balanceOf(deployer.address)), "OTT");
  console.log("\nNext steps:");
  console.log("  1. Verify contracts on Etherscan");
  console.log("  2. Add orchestrator as reporter on NodeRegistry");
  console.log("  3. Add orchestrator as manager on TaskEscrow");
  console.log("  4. Update contract addresses in the Node app");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
