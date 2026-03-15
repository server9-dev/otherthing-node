import { expect } from "chai";
import { ethers } from "hardhat";
import { IPRegistry, WorkspaceRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("IPRegistry", function () {
  let ipRegistry: IPRegistry;
  let workspaceRegistry: WorkspaceRegistry;
  let owner: SignerWithAddress;
  let member1: SignerWithAddress;
  let nonMember: SignerWithAddress;
  let workspaceId: string;

  beforeEach(async function () {
    [owner, member1, nonMember] = await ethers.getSigners();

    // Deploy WorkspaceRegistry
    const WorkspaceRegistryFactory = await ethers.getContractFactory("WorkspaceRegistry");
    workspaceRegistry = await WorkspaceRegistryFactory.deploy();

    // Deploy IPRegistry
    const IPRegistryFactory = await ethers.getContractFactory("IPRegistry");
    ipRegistry = await IPRegistryFactory.deploy(await workspaceRegistry.getAddress());

    // Create a workspace
    const tx = await workspaceRegistry.createWorkspace("Test Workspace", "A test workspace", true, "");
    const receipt = await tx.wait();
    const event = receipt!.logs.find(
      (log: any) => log.fragment?.name === "WorkspaceCreated"
    ) as any;
    workspaceId = event.args[0];

    // Add member
    await workspaceRegistry.connect(member1).joinPublicWorkspace(workspaceId);
  });

  describe("registerIP", function () {
    it("Should register IP for a task", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));

      await expect(
        ipRegistry.registerIP(workspaceId, taskId, 0, "QmIPFSHash123")
      ).to.emit(ipRegistry, "IPRegistered");

      expect(await ipRegistry.hasIPRegistered(taskId)).to.be.true;

      const registration = await ipRegistry.getIPForTask(taskId);
      expect(registration.workspaceId).to.equal(workspaceId);
      expect(registration.taskId).to.equal(taskId);
      expect(registration.creator).to.equal(owner.address);
      expect(registration.licenseCid).to.equal("QmIPFSHash123");
      expect(registration.licenseType).to.equal(0); // MIT
    });

    it("Should reject registration by non-member", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));

      await expect(
        ipRegistry.connect(nonMember).registerIP(workspaceId, taskId, 0, "QmIPFSHash123")
      ).to.be.revertedWith("IPRegistry: not a member");
    });

    it("Should reject duplicate IP registration for same task", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));

      await ipRegistry.registerIP(workspaceId, taskId, 0, "QmIPFSHash123");

      await expect(
        ipRegistry.registerIP(workspaceId, taskId, 1, "QmIPFSHash456")
      ).to.be.revertedWith("IPRegistry: task already has IP registered");
    });

    it("Should reject empty license CID", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));

      await expect(
        ipRegistry.registerIP(workspaceId, taskId, 0, "")
      ).to.be.revertedWith("IPRegistry: empty license CID");
    });

    it("Should reject invalid license type", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));

      await expect(
        ipRegistry.registerIP(workspaceId, taskId, 5, "QmIPFSHash123")
      ).to.be.revertedWith("IPRegistry: invalid license type");
    });
  });

  describe("hasIPRegistered", function () {
    it("Should return false for unregistered task", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
      expect(await ipRegistry.hasIPRegistered(taskId)).to.be.false;
    });

    it("Should return true after registration", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));
      await ipRegistry.registerIP(workspaceId, taskId, 2, "QmIPFSHash123");
      expect(await ipRegistry.hasIPRegistered(taskId)).to.be.true;
    });
  });

  describe("getWorkspaceIP", function () {
    it("Should return all registrations for a workspace", async function () {
      const taskId1 = ethers.keccak256(ethers.toUtf8Bytes("task1"));
      const taskId2 = ethers.keccak256(ethers.toUtf8Bytes("task2"));

      await ipRegistry.registerIP(workspaceId, taskId1, 0, "QmIPFS1");
      await ipRegistry.registerIP(workspaceId, taskId2, 1, "QmIPFS2");

      const registrations = await ipRegistry.getWorkspaceIP(workspaceId);
      expect(registrations.length).to.equal(2);
    });

    it("Should return empty array for workspace with no registrations", async function () {
      const registrations = await ipRegistry.getWorkspaceIP(workspaceId);
      expect(registrations.length).to.equal(0);
    });
  });
});
