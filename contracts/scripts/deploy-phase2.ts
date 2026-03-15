import { ethers } from "hardhat";

// Existing deployed contract addresses on Sepolia
const DEPLOYED = {
  OTT: "0x201333A5C882751a98E483f9B763DF4D8e5A1055",
  NodeRegistry: "0xFaCB01A565ea526FC8CAC87D5D4622983735e8F3",
  TaskEscrow: "0x246127F9743AC938baB7fc221546a785C880ad86",
  WorkspaceRegistry: "0x8433285448DB684b9a37b4bc97DBDcd72e148DCa",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Phase 4 contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  console.log("\nUsing existing contracts:");
  console.log("  OTT:               ", DEPLOYED.OTT);
  console.log("  NodeRegistry:      ", DEPLOYED.NodeRegistry);
  console.log("  WorkspaceRegistry: ", DEPLOYED.WorkspaceRegistry);

  // 1. Deploy AgreementRegistry
  console.log("\n1. Deploying AgreementRegistry...");
  const AgreementRegistry = await ethers.getContractFactory("AgreementRegistry");
  const agreementRegistry = await AgreementRegistry.deploy(DEPLOYED.WorkspaceRegistry);
  await agreementRegistry.waitForDeployment();
  const agreementRegistryAddress = await agreementRegistry.getAddress();
  console.log("   AgreementRegistry deployed to:", agreementRegistryAddress);

  // 2. Deploy IPRegistry
  console.log("\n2. Deploying IPRegistry...");
  const IPRegistry = await ethers.getContractFactory("IPRegistry");
  const ipRegistry = await IPRegistry.deploy(DEPLOYED.WorkspaceRegistry);
  await ipRegistry.waitForDeployment();
  const ipRegistryAddress = await ipRegistry.getAddress();
  console.log("   IPRegistry deployed to:", ipRegistryAddress);

  // 3. Deploy MilestoneEscrow
  console.log("\n3. Deploying MilestoneEscrow...");
  const MilestoneEscrow = await ethers.getContractFactory("MilestoneEscrow");
  const milestoneEscrow = await MilestoneEscrow.deploy(
    DEPLOYED.OTT,
    DEPLOYED.NodeRegistry,
    agreementRegistryAddress,
    ipRegistryAddress
  );
  await milestoneEscrow.waitForDeployment();
  const milestoneEscrowAddress = await milestoneEscrow.getAddress();
  console.log("   MilestoneEscrow deployed to:", milestoneEscrowAddress);

  console.log("\n========================================");
  console.log("Phase 4 Deployment Complete!");
  console.log("========================================");
  console.log("\nNew Contract Addresses:");
  console.log("  AgreementRegistry: ", agreementRegistryAddress);
  console.log("  IPRegistry:        ", ipRegistryAddress);
  console.log("  MilestoneEscrow:   ", milestoneEscrowAddress);
  console.log("\nNext steps:");
  console.log("  1. Verify contracts on Etherscan");
  console.log("  2. Update contract addresses in the Node app");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
