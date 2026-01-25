import { ethers } from "hardhat";

const OTT_ADDRESS = "0x201333A5C882751a98E483f9B763DF4D8e5A1055";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying NodeRegistry with account:", deployer.address);

  const NodeRegistry = await ethers.getContractFactory("NodeRegistry");
  const nodeRegistry = await NodeRegistry.deploy(OTT_ADDRESS);
  await nodeRegistry.waitForDeployment();

  const address = await nodeRegistry.getAddress();
  console.log("NodeRegistry deployed to:", address);

  // Fund with OTT for rewards
  const OTT = await ethers.getContractAt("OTT", OTT_ADDRESS);
  const fundAmount = ethers.parseEther("1000000"); // 1M OTT
  await OTT.transfer(address, fundAmount);
  console.log("Funded NodeRegistry with 1M OTT");
}

main().catch(console.error);
