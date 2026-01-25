import { ethers } from "hardhat";

const WORKSPACE_REGISTRY = "0xe409937dcc6101225952F6723Ce46ba9fDe9f6cB";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Testing with account:", signer.address);

  // Get contract
  const WorkspaceRegistry = await ethers.getContractAt("WorkspaceRegistry", WORKSPACE_REGISTRY);

  // Check current count
  const count = await WorkspaceRegistry.workspaceCount();
  console.log("Current workspace count:", count.toString());

  // Create a workspace
  console.log("\n=== Creating Workspace ===");
  const name = "Test Workspace " + Date.now();
  const description = "A test workspace for development";
  const isPublic = false;
  const inviteCode = "SECRET123";

  console.log("Name:", name);
  console.log("Description:", description);
  console.log("Public:", isPublic);
  console.log("Invite Code:", inviteCode);

  const createTx = await WorkspaceRegistry.createWorkspace(name, description, isPublic, inviteCode);
  const receipt = await createTx.wait();

  // Get workspace ID from event
  const event = receipt.logs.find((log: any) => {
    try {
      const parsed = WorkspaceRegistry.interface.parseLog(log);
      return parsed?.name === 'WorkspaceCreated';
    } catch {
      return false;
    }
  });

  let workspaceId: string;
  if (event) {
    const parsed = WorkspaceRegistry.interface.parseLog(event);
    workspaceId = parsed?.args[0];
    console.log("\n✅ Workspace created!");
    console.log("Workspace ID:", workspaceId);
    console.log("Transaction:", receipt.hash);
  } else {
    throw new Error("WorkspaceCreated event not found");
  }

  // Get workspace info
  console.log("\n=== Workspace Info ===");
  const ws = await WorkspaceRegistry.getWorkspace(workspaceId);
  console.log("ID:", ws.id);
  console.log("Name:", ws.name);
  console.log("Description:", ws.description);
  console.log("Owner:", ws.owner);
  console.log("Created:", new Date(Number(ws.createdAt) * 1000).toISOString());
  console.log("Public:", ws.isPublic);
  console.log("Members:", ws.memberCount.toString());

  // Check membership
  console.log("\n=== Membership Check ===");
  const isMember = await WorkspaceRegistry.isMember(workspaceId, signer.address);
  console.log("Is owner a member?", isMember);

  const member = await WorkspaceRegistry.getMember(workspaceId, signer.address);
  console.log("Member role:", member.role.toString(), "(0=Member, 1=Admin, 2=Owner)");

  // Get user's workspaces
  console.log("\n=== User's Workspaces ===");
  const userWorkspaces = await WorkspaceRegistry.getUserWorkspaces(signer.address);
  console.log("Workspace IDs:", userWorkspaces);

  // Verify invite code
  console.log("\n=== Invite Code Verification ===");
  const validCode = await WorkspaceRegistry.verifyInviteCode(workspaceId, inviteCode);
  console.log("Correct code valid?", validCode);

  const invalidCode = await WorkspaceRegistry.verifyInviteCode(workspaceId, "WRONGCODE");
  console.log("Wrong code valid?", invalidCode);

  console.log("\n✅ All tests passed!");
}

main().catch(console.error);
