import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying WorkspaceRegistry with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy WorkspaceRegistry
  console.log("\nDeploying WorkspaceRegistry...");
  const WorkspaceRegistry = await ethers.getContractFactory("WorkspaceRegistry");
  const workspaceRegistry = await WorkspaceRegistry.deploy();
  await workspaceRegistry.waitForDeployment();

  const address = await workspaceRegistry.getAddress();
  console.log("WorkspaceRegistry deployed to:", address);

  console.log("\n=== Deployment Complete ===");
  console.log("WorkspaceRegistry:", address);
  console.log("\nUpdate CONTRACT_ADDRESSES in src/services/web3-service.ts:");
  console.log(`  workspaceRegistry: '${address}',`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
