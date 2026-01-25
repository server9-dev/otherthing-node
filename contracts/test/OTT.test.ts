import { expect } from "chai";
import { ethers } from "hardhat";
import { OTT, NodeRegistry, TaskEscrow } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("OtherThing Contracts", function () {
  let ott: OTT;
  let nodeRegistry: NodeRegistry;
  let taskEscrow: TaskEscrow;
  let owner: SignerWithAddress;
  let node1: SignerWithAddress;
  let requester: SignerWithAddress;

  beforeEach(async function () {
    [owner, node1, requester] = await ethers.getSigners();

    // Deploy OTT
    const OTTFactory = await ethers.getContractFactory("OTT");
    ott = await OTTFactory.deploy();

    // Deploy NodeRegistry
    const NodeRegistryFactory = await ethers.getContractFactory("NodeRegistry");
    nodeRegistry = await NodeRegistryFactory.deploy(await ott.getAddress());

    // Deploy TaskEscrow
    const TaskEscrowFactory = await ethers.getContractFactory("TaskEscrow");
    taskEscrow = await TaskEscrowFactory.deploy(await ott.getAddress(), owner.address);

    // Setup: Add NodeRegistry as minter
    await ott.addMinter(await nodeRegistry.getAddress());

    // Fund accounts with OTT
    await ott.transfer(node1.address, ethers.parseEther("10000"));
    await ott.transfer(requester.address, ethers.parseEther("10000"));
  });

  describe("OTT Token", function () {
    it("Should have correct initial supply", async function () {
      expect(await ott.totalSupply()).to.equal(ethers.parseEther("100000000"));
    });

    it("Should allow minting up to max supply", async function () {
      await ott.mint(node1.address, ethers.parseEther("1000"));
      expect(await ott.balanceOf(node1.address)).to.equal(ethers.parseEther("11000"));
    });

    it("Should prevent minting beyond max supply", async function () {
      await expect(
        ott.mint(node1.address, ethers.parseEther("1000000000"))
      ).to.be.revertedWith("OTT: max supply exceeded");
    });
  });

  describe("NodeRegistry", function () {
    const nodeId = ethers.keccak256(ethers.toUtf8Bytes("node1"));
    const capabilities = ethers.zeroPadValue("0x08", 32); // 8 CPU cores

    it("Should register a node with stake", async function () {
      const stake = ethers.parseEther("1000");
      await ott.connect(node1).approve(await nodeRegistry.getAddress(), stake);
      await nodeRegistry.connect(node1).registerNode(nodeId, stake, capabilities);

      const node = await nodeRegistry.getNode(nodeId);
      expect(node.owner).to.equal(node1.address);
      expect(node.stakedAmount).to.equal(stake);
      expect(node.isActive).to.be.true;
    });

    it("Should reject registration with low stake", async function () {
      const lowStake = ethers.parseEther("100");
      await ott.connect(node1).approve(await nodeRegistry.getAddress(), lowStake);
      await expect(
        nodeRegistry.connect(node1).registerNode(nodeId, lowStake, capabilities)
      ).to.be.revertedWith("NodeRegistry: stake too low");
    });

    it("Should report compute and accumulate rewards", async function () {
      const stake = ethers.parseEther("1000");
      await ott.connect(node1).approve(await nodeRegistry.getAddress(), stake);
      await nodeRegistry.connect(node1).registerNode(nodeId, stake, capabilities);

      // Add owner as reporter
      await nodeRegistry.addReporter(owner.address);

      // Report compute
      await nodeRegistry.reportCompute(nodeId, 100);

      const node = await nodeRegistry.getNode(nodeId);
      expect(node.totalCompute).to.equal(100);
      expect(node.pendingRewards).to.be.gt(0);
    });
  });

  describe("TaskEscrow", function () {
    const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));
    const amount = ethers.parseEther("100");

    it("Should create a task with escrow", async function () {
      const fee = (amount * BigInt(5)) / BigInt(100);
      const total = amount + fee;

      await ott.connect(requester).approve(await taskEscrow.getAddress(), total);
      await taskEscrow.connect(requester).createTask(taskId, amount, "Test task");

      const task = await taskEscrow.getTask(taskId);
      expect(task.requester).to.equal(requester.address);
      expect(task.amount).to.equal(amount);
      expect(task.status).to.equal(0); // Created
    });

    it("Should allow cancellation before assignment", async function () {
      const fee = (amount * BigInt(5)) / BigInt(100);
      const total = amount + fee;

      await ott.connect(requester).approve(await taskEscrow.getAddress(), total);
      await taskEscrow.connect(requester).createTask(taskId, amount, "Test task");

      const balanceBefore = await ott.balanceOf(requester.address);
      await taskEscrow.connect(requester).cancelTask(taskId);
      const balanceAfter = await ott.balanceOf(requester.address);

      expect(balanceAfter - balanceBefore).to.equal(total);
    });
  });
});
