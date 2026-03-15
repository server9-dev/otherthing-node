/**
 * End-to-end test of all contracts on Sepolia
 *
 * Flow:
 * 1. Create two wallets (creator + worker), fund from funder
 * 2. Creator creates workspace on-chain
 * 3. Worker joins workspace
 * 4. Creator creates a required agreement
 * 5. Worker signs agreement
 * 6. Worker registers a node
 * 7. Creator creates a milestone task (escrows OTT)
 * 8. Creator assigns worker
 * 9. Worker submits milestone work
 * 10. Creator approves milestone
 * 11. Worker registers IP
 * 12. Release final milestone payment (checks IP)
 */

import { ethers } from "hardhat";

// Deployed addresses
const CONTRACTS = {
  OTT: "0x201333A5C882751a98E483f9B763DF4D8e5A1055",
  NodeRegistry: "0xFaCB01A565ea526FC8CAC87D5D4622983735e8F3",
  WorkspaceRegistry: "0x8433285448DB684b9a37b4bc97DBDcd72e148DCa",
  AgreementRegistry: "0xf5AfcA509Ed426d336d9676746cF6EdE3A2e7367",
  IPRegistry: "0xBCDD635bE62Bd83Cb99fc331818828cF685e1450",
  MilestoneEscrow: "0xBD29Ed6B5C2cC8e7dfefD31D2aCf39b1C760b015",
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function waitForTx(tx: any, label: string) {
  process.stdout.write(`   Waiting for tx...`);
  const receipt = await tx.wait();
  console.log(` confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);
  return receipt;
}

async function main() {
  const [funder] = await ethers.getSigners();
  console.log("========================================");
  console.log("  E2E Contract Test on Sepolia");
  console.log("========================================\n");
  console.log(`Funder: ${funder.address}`);

  const funderBal = await ethers.provider.getBalance(funder.address);
  console.log(`Funder ETH: ${ethers.formatEther(funderBal)}`);

  // ============ Step 1: Create and fund wallets ============
  console.log("\n--- Step 1: Create & Fund Wallets ---");

  const creatorWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const workerWallet = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log(`Creator: ${creatorWallet.address}`);
  console.log(`Worker:  ${workerWallet.address}`);

  // Fund with ETH
  const ethAmount = ethers.parseEther("0.005");
  console.log(`\n   Funding creator with 0.005 ETH...`);
  await waitForTx(
    await funder.sendTransaction({ to: creatorWallet.address, value: ethAmount }),
    "Fund creator ETH"
  );

  console.log(`   Funding worker with 0.005 ETH...`);
  await waitForTx(
    await funder.sendTransaction({ to: workerWallet.address, value: ethAmount }),
    "Fund worker ETH"
  );

  // Fund with OTT
  const ott = await ethers.getContractAt("OTT", CONTRACTS.OTT, funder);
  const ottAmount = ethers.parseEther("1000");

  console.log(`   Funding creator with 1000 OTT...`);
  await waitForTx(await ott.transfer(creatorWallet.address, ottAmount), "Fund creator OTT");

  console.log(`   Funding worker with 1000 OTT...`);
  await waitForTx(await ott.transfer(workerWallet.address, ottAmount), "Fund worker OTT");

  const creatorOtt = await ott.balanceOf(creatorWallet.address);
  const workerOtt = await ott.balanceOf(workerWallet.address);
  console.log(`\n   Creator OTT: ${ethers.formatEther(creatorOtt)}`);
  console.log(`   Worker OTT:  ${ethers.formatEther(workerOtt)}`);

  // ============ Step 2: Create workspace ============
  console.log("\n--- Step 2: Creator Creates Workspace ---");

  const workspaceRegistry = await ethers.getContractAt(
    "WorkspaceRegistry", CONTRACTS.WorkspaceRegistry, creatorWallet
  );

  const createWsTx = await workspaceRegistry.createWorkspace(
    "E2E Test Workspace",
    "Testing all contracts end-to-end",
    true, // public
    ""
  );
  const wsReceipt = await waitForTx(createWsTx, "Create workspace");

  // Extract workspaceId from event
  let workspaceId = "";
  for (const log of wsReceipt.logs) {
    try {
      const parsed = workspaceRegistry.interface.parseLog(log);
      if (parsed?.name === "WorkspaceCreated") {
        workspaceId = parsed.args[0];
        break;
      }
    } catch {}
  }
  console.log(`   Workspace ID: ${workspaceId.slice(0, 18)}...`);

  // ============ Step 3: Worker joins workspace ============
  console.log("\n--- Step 3: Worker Joins Workspace ---");

  const workerWsRegistry = workspaceRegistry.connect(workerWallet);
  await waitForTx(
    await workerWsRegistry.joinPublicWorkspace(workspaceId),
    "Worker joins workspace"
  );

  const members = await workspaceRegistry.getWorkspaceMembers(workspaceId);
  console.log(`   Members: ${members.length} (creator + worker)`);

  // ============ Step 4: Create required agreement ============
  console.log("\n--- Step 4: Creator Creates Required Agreement ---");

  const agreementRegistry = await ethers.getContractAt(
    "AgreementRegistry", CONTRACTS.AgreementRegistry, creatorWallet
  );

  const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA Document v1.0"));
  const block = await ethers.provider.getBlock("latest");
  const expiresAt = block!.timestamp + 365 * 86400; // 1 year

  const createAgreementTx = await agreementRegistry.createAgreement(
    workspaceId,
    docHash,
    "E2E Test NDA",
    0, // NDA type
    expiresAt,
    true // required
  );
  const agReceipt = await waitForTx(createAgreementTx, "Create agreement");

  let agreementId = 0;
  for (const log of agReceipt.logs) {
    try {
      const parsed = agreementRegistry.interface.parseLog(log);
      if (parsed?.name === "AgreementCreated") {
        agreementId = Number(parsed.args[0]);
        break;
      }
    } catch {}
  }
  console.log(`   Agreement ID: ${agreementId}`);

  // Creator also signs
  console.log(`   Creator signing agreement...`);
  await waitForTx(await agreementRegistry.signAgreement(agreementId), "Creator signs");

  // ============ Step 5: Worker signs agreement ============
  console.log("\n--- Step 5: Worker Signs Agreement ---");

  const workerAgreementRegistry = agreementRegistry.connect(workerWallet);

  // Check before signing
  let hasSignedBefore = await agreementRegistry.hasSignedRequired(workspaceId, workerWallet.address);
  console.log(`   Worker hasSignedRequired before: ${hasSignedBefore}`);

  await waitForTx(
    await workerAgreementRegistry.signAgreement(agreementId),
    "Worker signs agreement"
  );

  let hasSignedAfter = await agreementRegistry.hasSignedRequired(workspaceId, workerWallet.address);
  console.log(`   Worker hasSignedRequired after:  ${hasSignedAfter}`);

  const signers = await agreementRegistry.getSignatures(agreementId);
  console.log(`   Total signers: ${signers.length}`);

  // ============ Step 6: Worker registers node ============
  console.log("\n--- Step 6: Worker Registers Node ---");

  const nodeRegistry = await ethers.getContractAt(
    "NodeRegistry", CONTRACTS.NodeRegistry, workerWallet
  );
  const workerOttContract = ott.connect(workerWallet);

  const stakeAmount = ethers.parseEther("100"); // min stake
  console.log(`   Approving 100 OTT stake...`);
  await waitForTx(
    await workerOttContract.approve(CONTRACTS.NodeRegistry, stakeAmount),
    "Approve stake"
  );

  console.log(`   Registering node...`);
  const registerTx = await nodeRegistry.registerNode(
    {
      cpuCores: 8,
      memoryMb: 16384,
      gpuCount: 1,
      gpuVramMb: 8192,
      hasOllama: true,
      hasSandbox: true,
    },
    "https://test-worker.otherthing.io",
    stakeAmount
  );
  const regReceipt = await waitForTx(registerTx, "Register node");

  let nodeId = "";
  for (const log of regReceipt.logs) {
    try {
      const parsed = nodeRegistry.interface.parseLog(log);
      if (parsed?.name === "NodeRegistered") {
        nodeId = parsed.args[0];
        break;
      }
    } catch {}
  }
  console.log(`   Node ID: ${nodeId.slice(0, 18)}...`);

  const isEligible = await nodeRegistry.isNodeEligible(nodeId);
  console.log(`   Node eligible: ${isEligible}`);

  // ============ Step 7: Create milestone task ============
  console.log("\n--- Step 7: Creator Creates Milestone Task ---");

  const milestoneEscrow = await ethers.getContractAt(
    "MilestoneEscrow", CONTRACTS.MilestoneEscrow, creatorWallet
  );
  const creatorOttContract = ott.connect(creatorWallet);

  const milestone1Amount = ethers.parseEther("50");
  const milestone2Amount = ethers.parseEther("50");
  const totalAmount = milestone1Amount + milestone2Amount;
  const platformFee = totalAmount * 5n / 100n;
  const totalRequired = totalAmount + platformFee; // 105 OTT

  console.log(`   Total escrow: ${ethers.formatEther(totalRequired)} OTT (${ethers.formatEther(totalAmount)} + ${ethers.formatEther(platformFee)} fee)`);

  console.log(`   Approving OTT...`);
  await waitForTx(
    await creatorOttContract.approve(CONTRACTS.MilestoneEscrow, totalRequired),
    "Approve escrow"
  );

  const deadline = block!.timestamp + 30 * 86400; // 30 days
  console.log(`   Creating task...`);
  const createTaskTx = await milestoneEscrow.createTask(
    workspaceId,
    "QmE2ETestDescription123",
    deadline,
    ["Design the widget", "Build the widget"],
    [milestone1Amount, milestone2Amount]
  );
  const taskReceipt = await waitForTx(createTaskTx, "Create task");

  let taskId = "";
  for (const log of taskReceipt.logs) {
    try {
      const parsed = milestoneEscrow.interface.parseLog(log);
      if (parsed?.name === "TaskCreated") {
        taskId = parsed.args[0];
        break;
      }
    } catch {}
  }
  console.log(`   Task ID: ${taskId.slice(0, 18)}...`);

  const creatorOttAfter = await ott.balanceOf(creatorWallet.address);
  console.log(`   Creator OTT after escrow: ${ethers.formatEther(creatorOttAfter)}`);

  // ============ Step 8: Assign worker ============
  console.log("\n--- Step 8: Creator Assigns Worker ---");

  await waitForTx(
    await milestoneEscrow.assignWorker(taskId, workerWallet.address, nodeId),
    "Assign worker"
  );
  console.log(`   Worker assigned: ${shortAddr(workerWallet.address)}`);

  // ============ Step 9: Worker submits milestone 1 ============
  console.log("\n--- Step 9: Worker Submits Milestone 1 ---");

  const workerEscrow = milestoneEscrow.connect(workerWallet);
  await waitForTx(
    await workerEscrow.submitMilestone(taskId, 0, "QmMilestone1WorkProof"),
    "Submit milestone 1"
  );
  console.log(`   Milestone 1 submitted with CID: QmMilestone1WorkProof`);

  // ============ Step 10: Creator approves + releases milestone 1 ============
  console.log("\n--- Step 10: Creator Approves & Releases Milestone 1 ---");

  await waitForTx(
    await milestoneEscrow.approveMilestone(taskId, 0),
    "Approve milestone 1"
  );
  console.log(`   Milestone 1 approved`);

  await waitForTx(
    await milestoneEscrow.releaseMilestonePayment(taskId, 0),
    "Release milestone 1 payment"
  );

  const workerOttAfterM1 = await ott.balanceOf(workerWallet.address);
  console.log(`   Worker OTT after milestone 1: ${ethers.formatEther(workerOttAfterM1)}`);

  // ============ Step 11: Worker submits milestone 2 ============
  console.log("\n--- Step 11: Worker Submits Milestone 2 ---");

  await waitForTx(
    await workerEscrow.submitMilestone(taskId, 1, "QmMilestone2FinalWork"),
    "Submit milestone 2"
  );
  console.log(`   Milestone 2 submitted`);

  // ============ Step 12: Creator approves milestone 2 ============
  console.log("\n--- Step 12: Creator Approves Milestone 2 ---");

  await waitForTx(
    await milestoneEscrow.approveMilestone(taskId, 1),
    "Approve milestone 2"
  );
  console.log(`   Milestone 2 approved`);

  // ============ Step 13: Worker registers IP (required for final payment) ============
  console.log("\n--- Step 13: Worker Registers IP ---");

  const ipRegistry = await ethers.getContractAt(
    "IPRegistry", CONTRACTS.IPRegistry, workerWallet
  );

  await waitForTx(
    await ipRegistry.registerIP(
      workspaceId,
      taskId,
      0, // MIT license
      "QmLicenseDocumentCID"
    ),
    "Register IP"
  );

  const hasIP = await ipRegistry.hasIPRegistered(taskId);
  console.log(`   IP registered: ${hasIP}`);

  // ============ Step 14: Release final milestone payment ============
  console.log("\n--- Step 14: Release Final Milestone Payment ---");

  await waitForTx(
    await milestoneEscrow.releaseMilestonePayment(taskId, 1),
    "Release milestone 2 payment"
  );

  const workerOttFinal = await ott.balanceOf(workerWallet.address);
  console.log(`   Worker OTT final: ${ethers.formatEther(workerOttFinal)}`);

  // ============ Summary ============
  console.log("\n========================================");
  console.log("  E2E TEST COMPLETE - ALL PASSED");
  console.log("========================================");
  console.log(`\n  Workspace:  ${workspaceId.slice(0, 18)}...`);
  console.log(`  Agreement:  #${agreementId}`);
  console.log(`  Node:       ${nodeId.slice(0, 18)}...`);
  console.log(`  Task:       ${taskId.slice(0, 18)}...`);
  console.log(`  IP:         MIT license registered`);
  console.log(`\n  Creator started with: 1000 OTT`);
  console.log(`  Creator final:        ${ethers.formatEther(await ott.balanceOf(creatorWallet.address))} OTT`);
  console.log(`  Worker started with:  1000 OTT (staked 100)`);
  console.log(`  Worker final:         ${ethers.formatEther(workerOttFinal)} OTT`);
  console.log(`  Platform fee:         ${ethers.formatEther(platformFee)} OTT`);

  const funderBalFinal = await ethers.provider.getBalance(funder.address);
  console.log(`\n  Funder ETH spent:     ${ethers.formatEther(funderBal - funderBalFinal)} ETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nE2E TEST FAILED:", error);
    process.exit(1);
  });
