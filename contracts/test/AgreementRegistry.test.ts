import { expect } from "chai";
import { ethers } from "hardhat";
import { AgreementRegistry, WorkspaceRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgreementRegistry", function () {
  let agreementRegistry: AgreementRegistry;
  let workspaceRegistry: WorkspaceRegistry;
  let owner: SignerWithAddress;
  let member1: SignerWithAddress;
  let member2: SignerWithAddress;
  let nonMember: SignerWithAddress;
  let workspaceId: string;

  beforeEach(async function () {
    [owner, member1, member2, nonMember] = await ethers.getSigners();

    // Deploy WorkspaceRegistry
    const WorkspaceRegistryFactory = await ethers.getContractFactory("WorkspaceRegistry");
    workspaceRegistry = await WorkspaceRegistryFactory.deploy();

    // Deploy AgreementRegistry
    const AgreementRegistryFactory = await ethers.getContractFactory("AgreementRegistry");
    agreementRegistry = await AgreementRegistryFactory.deploy(await workspaceRegistry.getAddress());

    // Create a workspace and add members
    const tx = await workspaceRegistry.createWorkspace("Test Workspace", "A test workspace", true, "");
    const receipt = await tx.wait();

    // Get workspace ID from event
    const event = receipt!.logs.find(
      (log: any) => log.fragment?.name === "WorkspaceCreated"
    ) as any;
    workspaceId = event.args[0];

    // Add members by having them join the public workspace
    await workspaceRegistry.connect(member1).joinPublicWorkspace(workspaceId);
    await workspaceRegistry.connect(member2).joinPublicWorkspace(workspaceId);
  });

  describe("createAgreement", function () {
    it("Should create an agreement as a workspace member", async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA document"));

      await expect(
        agreementRegistry.createAgreement(
          workspaceId,
          docHash,
          "Test NDA",
          0, // NDA
          0, // no expiration
          true // required
        )
      ).to.emit(agreementRegistry, "AgreementCreated");

      const agreements = await agreementRegistry.getAgreements(workspaceId);
      expect(agreements.length).to.equal(1);

      const agreement = await agreementRegistry.getAgreement(agreements[0]);
      expect(agreement.title).to.equal("Test NDA");
      expect(agreement.workspaceId).to.equal(workspaceId);
      expect(agreement.creator).to.equal(owner.address);
      expect(agreement.required).to.be.true;
    });

    it("Should reject agreement creation by non-member", async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA document"));

      await expect(
        agreementRegistry.connect(nonMember).createAgreement(
          workspaceId,
          docHash,
          "Test NDA",
          0,
          0,
          true
        )
      ).to.be.revertedWith("AgreementRegistry: not a member");
    });

    it("Should reject empty document hash", async function () {
      await expect(
        agreementRegistry.createAgreement(
          workspaceId,
          ethers.ZeroHash,
          "Test NDA",
          0,
          0,
          true
        )
      ).to.be.revertedWith("AgreementRegistry: empty document hash");
    });
  });

  describe("signAgreement", function () {
    let agreementId: bigint;

    beforeEach(async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA document"));
      const tx = await agreementRegistry.createAgreement(
        workspaceId,
        docHash,
        "Test NDA",
        0,
        0,
        true
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (log: any) => log.fragment?.name === "AgreementCreated"
      ) as any;
      agreementId = event.args[0];
    });

    it("Should allow a member to sign an agreement", async function () {
      await expect(
        agreementRegistry.connect(member1).signAgreement(agreementId)
      ).to.emit(agreementRegistry, "AgreementSigned")
        .withArgs(agreementId, member1.address);

      expect(await agreementRegistry.hasSigned(agreementId, member1.address)).to.be.true;

      const signers = await agreementRegistry.getSignatures(agreementId);
      expect(signers.length).to.equal(1);
      expect(signers[0]).to.equal(member1.address);
    });

    it("Should reject double signing", async function () {
      await agreementRegistry.connect(member1).signAgreement(agreementId);

      await expect(
        agreementRegistry.connect(member1).signAgreement(agreementId)
      ).to.be.revertedWith("AgreementRegistry: already signed");
    });

    it("Should reject signing by non-member", async function () {
      await expect(
        agreementRegistry.connect(nonMember).signAgreement(agreementId)
      ).to.be.revertedWith("AgreementRegistry: not a member");
    });
  });

  describe("hasSignedRequired", function () {
    it("Should return true when no required agreements exist", async function () {
      expect(
        await agreementRegistry.hasSignedRequired(workspaceId, member1.address)
      ).to.be.true;
    });

    it("Should return false when required agreement is not signed", async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA document"));
      await agreementRegistry.createAgreement(workspaceId, docHash, "Required NDA", 0, 0, true);

      expect(
        await agreementRegistry.hasSignedRequired(workspaceId, member1.address)
      ).to.be.false;
    });

    it("Should return true when all required agreements are signed", async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA document"));
      const tx = await agreementRegistry.createAgreement(workspaceId, docHash, "Required NDA", 0, 0, true);
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (log: any) => log.fragment?.name === "AgreementCreated"
      ) as any;
      const agreementId = event.args[0];

      await agreementRegistry.connect(member1).signAgreement(agreementId);

      expect(
        await agreementRegistry.hasSignedRequired(workspaceId, member1.address)
      ).to.be.true;
    });

    it("Should ignore non-required agreements", async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("Optional doc"));
      await agreementRegistry.createAgreement(workspaceId, docHash, "Optional Agreement", 3, 0, false);

      expect(
        await agreementRegistry.hasSignedRequired(workspaceId, member1.address)
      ).to.be.true;
    });

    it("Should skip expired required agreements", async function () {
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("NDA document"));
      // Create with a very short expiration (1 second from now)
      const block = await ethers.provider.getBlock("latest");
      const expiresAt = block!.timestamp + 2;

      await agreementRegistry.createAgreement(workspaceId, docHash, "Expiring NDA", 0, expiresAt, true);

      // Fast forward time past expiration
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      // Should return true because the required agreement is expired
      expect(
        await agreementRegistry.hasSignedRequired(workspaceId, member1.address)
      ).to.be.true;
    });
  });
});
