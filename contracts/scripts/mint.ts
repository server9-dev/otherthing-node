import { ethers } from "hardhat";

async function main() {
  const OTT = await ethers.getContractAt("OTT", "0x201333A5C882751a98E483f9B763DF4D8e5A1055");
  const [signer] = await ethers.getSigners();

  console.log("Minting 10,000 OTT to", signer.address);
  const tx = await OTT.mint(signer.address, ethers.parseEther("10000"));
  await tx.wait();
  console.log("Done! Tx:", tx.hash);

  const balance = await OTT.balanceOf(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "OTT");
}

main().catch(console.error);
