import { expect } from "chai";
import { ethers } from "hardhat";
import {
  OTT,
  NodeRegistry,
  WorkspaceRegistry,
  AgreementRegistry,
  IPRegistry,
  MilestoneEscrow,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MilestoneEscrow", function () {
  let ott: OTT;
  let nodeRegistry: NodeRegistry;
  let workspaceRegistry: WorkspaceRegistry;
  let agreementRegistry: AgreementRegistry;
  let ipRegistry: IPRegistry;
  let milestoneEscrow: MilestoneEscrow;

  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let worker: SignerWithAddress;
  let nonMember: SignerWithAddress;

  let workspaceId: string;
  let nodeId: string;

  const MILESTONE_AMOUNT_1 = ethers.parseEther("50");
  const MILESTONE_AMOUNT_2 = ethers.parseEther("100");
  const TOTAL_AMOUNT = MILESTONE_AMOUNT_1 + MILESTONE_AMOUNT_2; // 150 OTT
  const PLATFORM_FEE = (TOTAL_AMOUNT * BigInt(5)) / BigInt(100); // 7.5 OTT

  beforeEach(async function () {
    [owner, creator, worker, nonMember] = await ethers.getSigners();

    // Deploy OTT
    const OTTFactory = await ethers.getContractFactory("OTT");
    ott = await OTTFactory.deploy();

    // Deploy NodeRegistry
    const NodeRegistryFactory = await ethers.getContractFactory("NodeRegistry");
    nodeRegistry = await NodeRegistryFactory.deploy(await ott.getAddress());

    // Deploy WorkspaceRegistry
    const WorkspaceRegistryFactory = await ethers.getContractFactory("WorkspaceRegistry");
    workspaceRegistry = await WorkspaceRegistryFactory.deploy();

    // Deploy AgreementRegistry
    const AgreementRegistryFactory = await ethers.getContractFactory("AgreementRegistry");
    agreementRegistry = await AgreementRegistryFactory.deploy(await workspaceRegistry.getAddress());

    // Deploy IPRegistry
    const IPRegistryFactory = await ethers.getContractFactory("IPRegistry");
    ipRegistry = await IPRegistryFactory.deploy(await workspaceRegistry.getAddress());

    // Deploy MilestoneEscrow
    const MilestoneEscrowFactory = await ethers.getContractFactory("MilestoneEscrow");
    milestoneEscrow = await MilestoneEscrowFactory.deploy(
      await ott.getAddress(),
      await nodeRegistry.getAddress(),
      await agreementRegistry.getAddress(),
      await ipRegistry.getAddress()
    );

    // Setup: Add NodeRegistry as minter
    await ott.addMinter(await nodeRegistry.getAddress());

    // Fund accounts with OTT
    await ott.transfer(creator.address, ethers.parseEther("10000"));
    await ott.transfer(worker.address, ethers.parseEther("10000"));

    // Create a workspace and add members
    const tx = await workspaceRegistry.connect(creator).createWorkspace(
      "Test Workspace", "A test workspace", true, ""
    );
    const receipt = await tx.wait();
    const event = receipt!.logs.find(
      (log: any) => log.fragment?.name === "WorkspaceCreated"
    ) as any;
    workspaceId = event.args[0];

    // Worker joins workspace
    await workspaceRegistry.connect(worker).joinPublicWorkspace(workspaceId);

    // Register a node for the worker
    const stake = ethers.parseEther("1000");
    await ott.connect(worker).approve(await nodeRegistry.getAddress(), stake);
    const capabilities = {
      cpuCores: 8,
      memoryMb: 16384,
      gpuCount: 1,
      gpuVramMb: 8192,
      hasOllama: true,
      hasSandbox: true,
    };
    const registerTx = await nodeRegistry.connect(worker).registerNode(capabilities, "http://localhost:8080", stake);
    const registerReceipt = await registerTx.wait();
    const nodeEvent = registerReceipt!.logs.find(
      (log: any) => log.fragment?.name === "NodeRegistered"
    ) as any;
    nodeId = nodeEvent.args[0];
  });

  async function createTestTask(): Promise<string> {
    const totalRequired = TOTAL_AMOUNT + PLATFORM_FEE;
    await ott.connect(creator).approve(await milestoneEscrow.getAddress(), totalRequired);

    // Use block timestamp instead of Date.now() to avoid Hardhat time mismatch
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 86400; // 1 day from latest block

    const tx = await milestoneEscrow.connect(creator).createTask(
      workspaceId,
      "QmTaskDescription",
      deadline,
      ["Design phase", "Implementation phase"],
      [MILESTONE_AMOUNT_1, MILESTONE_AMOUNT_2]
    );
    const receipt = await tx.wait();
    const event = receipt!.logs.find(
      (log: any) => log.fragment?.name === "TaskCreated"
    ) as any;
    return event.args[0];
  }

  describe("createTask", function () {
    it("Should create a task with milestones and escrow tokens", async function () {
      const taskId = await createTestTask();

      const task = await milestoneEscrow.getTask(taskId);
      expect(task.creator).to.equal(creator.address);
      expect(task.totalAmount).to.equal(TOTAL_AMOUNT);
      expect(task.platformFee).to.equal(PLATFORM_FEE);
      expect(task.milestoneCount).to.equal(2);
      expect(task.status).to.equal(0); // Created

      const milestones = await milestoneEscrow.getMilestones(taskId);
      expect(milestones.length).to.equal(2);
      expect(milestones[0].description).to.equal("Design phase");
      expect(milestones[0].amount).to.equal(MILESTONE_AMOUNT_1);
      expect(milestones[1].description).to.equal("Implementation phase");
      expect(milestones[1].amount).to.equal(MILESTONE_AMOUNT_2);

      // Check escrow balance
      const escrowBalance = await ott.balanceOf(await milestoneEscrow.getAddress());
      expect(escrowBalance).to.equal(TOTAL_AMOUNT + PLATFORM_FEE);
    });

    it("Should reject task with no milestones", async function () {
      await expect(
        milestoneEscrow.connect(creator).createTask(
          workspaceId, "QmDesc", Math.floor(Date.now() / 1000) + 86400, [], []
        )
      ).to.be.revertedWith("MilestoneEscrow: no milestones");
    });

    it("Should reject mismatched arrays", async function () {
      await expect(
        milestoneEscrow.connect(creator).createTask(
          workspaceId, "QmDesc", Math.floor(Date.now() / 1000) + 86400,
          ["Phase 1"], [MILESTONE_AMOUNT_1, MILESTONE_AMOUNT_2]
        )
      ).to.be.revertedWith("MilestoneEscrow: array length mismatch");
    });
  });

  describe("assignWorker", function () {
    it("Should assign a worker with eligible node and signed agreements", async function () {
      const taskId = await createTestTask();

      await expect(
        milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId)
      ).to.emit(milestoneEscrow, "WorkerAssigned")
        .withArgs(taskId, worker.address, nodeId);

      const task = await milestoneEscrow.getTask(taskId);
      expect(task.worker).to.equal(worker.address);
      expect(task.status).to.equal(1); // Assigned
    });

    it("Should reject assignment by non-creator", async function () {
      const taskId = await createTestTask();

      await expect(
        milestoneEscrow.connect(worker).assignWorker(taskId, worker.address, nodeId)
      ).to.be.revertedWith("MilestoneEscrow: not creator");
    });

    it("Should reject assignment with ineligible node", async function () {
      const taskId = await createTestTask();
      const fakeNodeId = ethers.keccak256(ethers.toUtf8Bytes("fakeNode"));

      await expect(
        milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, fakeNodeId)
      ).to.be.revertedWith("MilestoneEscrow: node not eligible");
    });

    it("Should reject assignment when required agreements not signed", async function () {
      // Create a required agreement
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA"));
      await agreementRegistry.connect(creator).createAgreement(
        workspaceId, docHash, "Required NDA", 0, 0, true
      );

      const taskId = await createTestTask();

      // Worker has NOT signed the agreement
      await expect(
        milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId)
      ).to.be.revertedWith("MilestoneEscrow: agreements not signed");
    });
  });

  describe("Milestone workflow", function () {
    let taskId: string;

    beforeEach(async function () {
      taskId = await createTestTask();
      await milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId);
    });

    it("Should submit a milestone", async function () {
      await expect(
        milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWorkResult1")
      ).to.emit(milestoneEscrow, "MilestoneSubmitted")
        .withArgs(taskId, 0, "QmWorkResult1");

      const milestones = await milestoneEscrow.getMilestones(taskId);
      expect(milestones[0].status).to.equal(1); // Submitted
      expect(milestones[0].workCid).to.equal("QmWorkResult1");

      // Task should be InProgress
      const task = await milestoneEscrow.getTask(taskId);
      expect(task.status).to.equal(2); // InProgress
    });

    it("Should reject submission by non-worker", async function () {
      await expect(
        milestoneEscrow.connect(creator).submitMilestone(taskId, 0, "QmWork")
      ).to.be.revertedWith("MilestoneEscrow: not worker");
    });

    it("Should approve a submitted milestone", async function () {
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWorkResult1");

      await expect(
        milestoneEscrow.connect(creator).approveMilestone(taskId, 0)
      ).to.emit(milestoneEscrow, "MilestoneApproved")
        .withArgs(taskId, 0);

      const milestones = await milestoneEscrow.getMilestones(taskId);
      expect(milestones[0].status).to.equal(2); // Approved
    });

    it("Should release payment for a non-final milestone", async function () {
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWorkResult1");
      await milestoneEscrow.connect(creator).approveMilestone(taskId, 0);

      const workerBalanceBefore = await ott.balanceOf(worker.address);

      await expect(
        milestoneEscrow.connect(creator).releaseMilestonePayment(taskId, 0)
      ).to.emit(milestoneEscrow, "MilestonePaymentReleased")
        .withArgs(taskId, 0, worker.address, MILESTONE_AMOUNT_1);

      const workerBalanceAfter = await ott.balanceOf(worker.address);
      expect(workerBalanceAfter - workerBalanceBefore).to.equal(MILESTONE_AMOUNT_1);

      const milestones = await milestoneEscrow.getMilestones(taskId);
      expect(milestones[0].status).to.equal(3); // Paid
    });

    it("Should require IP registration for final milestone payment", async function () {
      // Complete milestone 0
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWork1");
      await milestoneEscrow.connect(creator).approveMilestone(taskId, 0);
      await milestoneEscrow.connect(creator).releaseMilestonePayment(taskId, 0);

      // Submit and approve milestone 1 (final)
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 1, "QmWork2");
      await milestoneEscrow.connect(creator).approveMilestone(taskId, 1);

      // Try to release without IP registration
      await expect(
        milestoneEscrow.connect(creator).releaseMilestonePayment(taskId, 1)
      ).to.be.revertedWith("MilestoneEscrow: IP not registered for task");

      // Register IP
      await ipRegistry.connect(creator).registerIP(workspaceId, taskId, 0, "QmLicense");

      // Now release should work
      const workerBalanceBefore = await ott.balanceOf(worker.address);
      await milestoneEscrow.connect(creator).releaseMilestonePayment(taskId, 1);
      const workerBalanceAfter = await ott.balanceOf(worker.address);

      expect(workerBalanceAfter - workerBalanceBefore).to.equal(MILESTONE_AMOUNT_2);

      // Task should be completed
      const task = await milestoneEscrow.getTask(taskId);
      expect(task.status).to.equal(3); // Completed
    });

    it("Should handle full milestone workflow end-to-end", async function () {
      // Register IP upfront
      await ipRegistry.connect(creator).registerIP(workspaceId, taskId, 0, "QmLicense");

      // Milestone 0: submit -> approve -> pay
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWork1");
      await milestoneEscrow.connect(creator).approveMilestone(taskId, 0);
      await milestoneEscrow.connect(creator).releaseMilestonePayment(taskId, 0);

      // Milestone 1: submit -> approve -> pay
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 1, "QmWork2");
      await milestoneEscrow.connect(creator).approveMilestone(taskId, 1);

      const ownerBalanceBefore = await ott.balanceOf(owner.address);
      await milestoneEscrow.connect(creator).releaseMilestonePayment(taskId, 1);
      const ownerBalanceAfter = await ott.balanceOf(owner.address);

      // Fee recipient (owner/deployer) should have received platform fee
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(PLATFORM_FEE);

      // All milestones paid
      const milestones = await milestoneEscrow.getMilestones(taskId);
      expect(milestones[0].status).to.equal(3); // Paid
      expect(milestones[1].status).to.equal(3); // Paid

      // Task completed
      const task = await milestoneEscrow.getTask(taskId);
      expect(task.status).to.equal(3); // Completed

      // Escrow should be empty
      const escrowBalance = await ott.balanceOf(await milestoneEscrow.getAddress());
      expect(escrowBalance).to.equal(0);
    });
  });

  describe("disputeMilestone", function () {
    it("Should allow creator to dispute within window", async function () {
      const taskId = await createTestTask();
      await milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId);
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWork1");

      await expect(
        milestoneEscrow.connect(creator).disputeMilestone(taskId, 0)
      ).to.emit(milestoneEscrow, "MilestoneDisputed")
        .withArgs(taskId, 0);

      const milestones = await milestoneEscrow.getMilestones(taskId);
      expect(milestones[0].status).to.equal(4); // Disputed

      const task = await milestoneEscrow.getTask(taskId);
      expect(task.status).to.equal(4); // Disputed
    });

    it("Should reject dispute after window closes", async function () {
      const taskId = await createTestTask();
      await milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId);
      await milestoneEscrow.connect(worker).submitMilestone(taskId, 0, "QmWork1");

      // Fast forward past dispute window (3 days + 1 second)
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        milestoneEscrow.connect(creator).disputeMilestone(taskId, 0)
      ).to.be.revertedWith("MilestoneEscrow: dispute window closed");
    });
  });

  describe("cancelTask", function () {
    it("Should cancel and refund before assignment", async function () {
      const taskId = await createTestTask();
      const balanceBefore = await ott.balanceOf(creator.address);

      await expect(
        milestoneEscrow.connect(creator).cancelTask(taskId)
      ).to.emit(milestoneEscrow, "TaskCancelled");

      const balanceAfter = await ott.balanceOf(creator.address);
      expect(balanceAfter - balanceBefore).to.equal(TOTAL_AMOUNT + PLATFORM_FEE);

      const task = await milestoneEscrow.getTask(taskId);
      expect(task.status).to.equal(5); // Cancelled
    });

    it("Should reject cancellation after assignment", async function () {
      const taskId = await createTestTask();
      await milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId);

      await expect(
        milestoneEscrow.connect(creator).cancelTask(taskId)
      ).to.be.revertedWith("MilestoneEscrow: task already assigned");
    });

    it("Should reject cancellation by non-creator", async function () {
      const taskId = await createTestTask();

      await expect(
        milestoneEscrow.connect(worker).cancelTask(taskId)
      ).to.be.revertedWith("MilestoneEscrow: not creator");
    });
  });

  describe("View functions", function () {
    it("Should track creator tasks", async function () {
      await createTestTask();
      await createTestTask();

      const tasks = await milestoneEscrow.getCreatorTasks(creator.address);
      expect(tasks.length).to.equal(2);
    });

    it("Should track worker tasks", async function () {
      const taskId = await createTestTask();
      await milestoneEscrow.connect(creator).assignWorker(taskId, worker.address, nodeId);

      const tasks = await milestoneEscrow.getWorkerTasks(worker.address);
      expect(tasks.length).to.equal(1);
      expect(tasks[0]).to.equal(taskId);
    });
  });
});
