import { ethers } from "hardhat";

const NODE_REGISTRY = "0xFaCB01A565ea526FC8CAC87D5D4622983735e8F3";
const OTT_ADDRESS = "0x201333A5C882751a98E483f9B763DF4D8e5A1055";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Testing with account:", signer.address);

  // Get contracts
  const OTT = await ethers.getContractAt("OTT", OTT_ADDRESS);
  const NodeRegistry = await ethers.getContractAt("NodeRegistry", NODE_REGISTRY);

  // Check OTT balance
  const balance = await OTT.balanceOf(signer.address);
  console.log("OTT Balance:", ethers.formatEther(balance));

  // Approve stake
  const stakeAmount = ethers.parseEther("100"); // min stake
  console.log("\nApproving 100 OTT for staking...");
  const approveTx = await OTT.approve(NODE_REGISTRY, stakeAmount);
  await approveTx.wait();
  console.log("Approved!");

  // Register node
  const capabilities = {
    cpuCores: 8,
    memoryMb: 16384,
    gpuCount: 1,
    gpuVramMb: 8192,
    hasOllama: true,
    hasSandbox: true
  };
  const endpoint = "http://localhost:8080";

  console.log("\nRegistering node...");
  console.log("Capabilities:", capabilities);
  console.log("Endpoint:", endpoint);
  console.log("Stake:", "100 OTT");

  const registerTx = await NodeRegistry.registerNode(capabilities, endpoint, stakeAmount);
  const receipt = await registerTx.wait();
  
  console.log("\n✅ Node registered successfully!");
  console.log("Transaction:", receipt.hash);

  // Get node info
  const nodeId = await NodeRegistry.ownerToNode(signer.address);
  console.log("Node ID:", nodeId);

  const nodeInfo = await NodeRegistry.nodes(nodeId);
  console.log("\nNode Info:");
  console.log("  Owner:", nodeInfo.owner);
  console.log("  Staked:", ethers.formatEther(nodeInfo.stakedAmount), "OTT");
  console.log("  Active:", nodeInfo.isActive);
  console.log("  Endpoint:", nodeInfo.endpoint);
}

main().catch(console.error);
