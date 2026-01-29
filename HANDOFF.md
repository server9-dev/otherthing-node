# OtherThing Node - Comprehensive Handoff Document

---

## ⚠️ CRITICAL: Current State (January 29, 2026)

### Status: MOSTLY WORKING - Major Issues Fixed

The app was migrated from Electron to Tauri. Most core features are now working after bug fixes. GitHub OAuth requires manual setup.

### What's Working ✅
| Feature | Status | Notes |
|---------|--------|-------|
| Sidecar startup | ✅ | `node dist/sidecar.js` works |
| Ollama detection | ✅ | Finds local Ollama, lists 7 models |
| GPU detection | ✅ | RTX 3070 + RTX 2060 via nvidia-smi fallback |
| Hardware detection | ✅ | Threadripper 64-core, 201GB RAM |
| Workspace creation | ✅ | API creates workspaces |
| Agent creation | ✅ | Agents start, call LLM |
| Vite dev server | ✅ | Frontend runs on :1420 |
| **Agent tools** | ✅ | Fixed - `local_read_file`, `local_list_dir`, `local_shell`, `local_find` working |

### What's Broken ❌
| Feature | Problem | Fix |
|---------|---------|-----|
| **GitHub OAuth** | Empty client_id in OAuth URL | Configuration required - see below |

### GitHub OAuth Setup (Required for repo connection)
1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Set Homepage URL to `http://localhost:8080`
3. Set Callback URL to `http://localhost:8080/auth/github/callback`
4. Set environment variables before starting the app:
   ```bash
   export GITHUB_CLIENT_ID="your_client_id"
   export GITHUB_CLIENT_SECRET="your_client_secret"
   ```

### Fixed ✅ (This Session)
| Feature | Fix Applied |
|---------|-------------|
| **Agent tools** | Added `initialize()` call in AgentService constructor |
| **Agent ID sync** | Fixed ID mismatch between api-server and agent-service - agent status now updates properly |
| **On-Bored analysis** | Was working - updated component/API detection paths |
| **IPFS download** | Added SSE endpoint `/api/v1/ipfs/download` with progress updates, updated api-bridge.ts |
| **Node → Workspace** | Added Share Key and Workspaces cards to NodeControl.tsx, API endpoints were working |

### Recent Fixes Applied (Still Not Working)

1. **GPU Detection** (`src/hardware.ts`)
   - Added `getNvidiaGpus()` fallback for WSL2 where systeminformation fails

2. **Agent nodeId Error** (`src/services/agent-service.ts:259`)
   - Added `nodeId: null` to toolContext to fix Zod validation error

3. **Local Filesystem Tools** (`src/adapters/agent.ts`)
   - Added `local_read_file`, `local_list_dir`, `local_shell`, `local_find`
   - Tools register but agent doesn't use them

### Root Cause Analysis

The Tauri migration broke the integration points:
- Electron's IPC was replaced with HTTP API calls
- Sidecar pattern adds complexity (Rust → Node.js)
- NodeService initialization flow different from Electron's main.ts
- Tool context not properly passed through call chain

### Recommended Action

**Option A: Fix Tauri** - Debug tool execution, trace why registered tools aren't found
**Option B: Revert to Electron** - The codebase was designed for Electron, everything worked

### Quick Test Commands
```bash
# Start backend
cd /mnt/d/github/node && node dist/sidecar.js

# Check services
curl http://localhost:8080/api/v1/hardware | jq .
curl http://localhost:8080/api/v1/ollama/status | jq .

# Create test agent (will fail on tools)
curl -X POST http://localhost:8080/api/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}' | jq -r '.id'
```

---

## Project Overview

**OtherThing Node** is a decentralized compute network where users can:
- Share their computer's processing power
- Earn OTT tokens for providing compute
- Create/join workspaces to collaborate with others
- Run AI agents using distributed compute resources

The project consists of:
1. **Electron Desktop App** - Node software users run on their machines
2. **Smart Contracts** - On-chain logic for staking, rewards, tasks, and workspaces
3. **Local Services** - Ollama (LLM), IPFS, Sandbox execution

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BLOCKCHAIN (Sepolia)                        │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────────────┐  │
│  │     OTT      │ │ NodeRegistry  │ │   WorkspaceRegistry    │  │
│  │   (ERC-20)   │ │  (Staking)    │ │  (On-chain groups)     │  │
│  └──────────────┘ └───────────────┘ └────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     TaskEscrow                            │   │
│  │              (Bounties, milestones, payments)             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON NODE APP                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    React Frontend                         │   │
│  │   - Dashboard (node status, earnings)                     │   │
│  │   - Workspaces (on-chain management)                      │   │
│  │   - Agents (AI task execution)                            │   │
│  │   - Blockchain (wallet, staking, registration)            │   │
│  │   - Settings                                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Main Process                           │   │
│  │   - API Server (Express on :8080)                         │   │
│  │   - Ollama Manager (LLM inference)                        │   │
│  │   - IPFS Manager (decentralized storage)                  │   │
│  │   - Sandbox Manager (isolated code execution)             │   │
│  │   - Agent Service (ReAct agent execution)                 │   │
│  │   - Web3 Service (blockchain interactions)                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL SERVICES                               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐     │
│  │    Ollama    │ │     IPFS     │ │      Sandbox         │     │
│  │  (LLM host)  │ │  (storage)   │ │  (code execution)    │     │
│  └──────────────┘ └──────────────┘ └──────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Smart Contracts (Sepolia Testnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| **OTT** | `0x201333A5C882751a98E483f9B763DF4D8e5A1055` | ERC-20 token for payments/staking |
| **NodeRegistry** | `0xFaCB01A565ea526FC8CAC87D5D4622983735e8F3` | Node registration, staking, rewards |
| **TaskEscrow** | `0x246127F9743AC938baB7fc221546a785C880ad86` | Task bounties and milestone payments |
| **WorkspaceRegistry** | `0xe409937dcc6101225952F6723Ce46ba9fDe9f6cB` | On-chain workspace management |

### Deployer/Funder Wallet
- **Address**: `0x683B811965A1225309e876bf82F1c6831C2311Aa`
- **Private Key**: `0x8ccc85bee32302669e4fed58d038a8373634dee36de8ae168f7cf07739b21979`
- **Used for**: Deploying contracts, funding test wallets

---

## Directory Structure

```
/mnt/d/github/node/
├── contracts/                    # Solidity smart contracts
│   ├── contracts/
│   │   ├── OTT.sol              # ERC-20 token
│   │   ├── NodeRegistry.sol     # Node staking/rewards
│   │   ├── TaskEscrow.sol       # Task bounties
│   │   └── WorkspaceRegistry.sol # On-chain workspaces
│   ├── scripts/
│   │   ├── deploy.ts            # Main deployment script
│   │   ├── deploy-workspace-registry.ts
│   │   ├── test-register.ts     # Test node registration
│   │   └── test-workspace.ts    # Test workspace creation
│   ├── hardhat.config.ts
│   └── typechain-types/         # Generated TypeScript types
│
├── src/
│   ├── main.ts                  # Electron main process entry
│   ├── preload.ts               # Electron preload script
│   ├── api-server.ts            # Express API server
│   ├── ollama-manager.ts        # Ollama LLM integration
│   ├── ipfs-manager.ts          # IPFS storage
│   ├── sandbox-manager.ts       # Isolated code execution
│   │
│   ├── services/
│   │   ├── web3-service.ts      # Blockchain interactions
│   │   ├── workspace-manager.ts # Local workspace storage
│   │   └── agent-service.ts     # AI agent execution
│   │
│   └── renderer/                # React frontend
│       ├── App.tsx
│       ├── main.tsx
│       ├── context/
│       │   └── Web3Context.tsx  # Wallet & contract state
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── Workspace.tsx    # On-chain workspaces
│       │   ├── WorkspaceDetail.tsx
│       │   ├── Agents.tsx
│       │   └── Settings.tsx
│       └── components/
│           ├── NodeBlockchain.tsx  # Blockchain tab
│           ├── WalletButton.tsx    # Wallet connection
│           └── CyberButton.tsx     # UI components
│
├── dist/                        # Compiled output
├── release/                     # Electron builds
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── vite.config.ts
└── electron-builder.json
```

---

## Key Features

### 1. Wallet Management
- **Create New Wallet**: Generates random wallet, shows private key
- **Import Private Key**: Connect with existing key
- **WalletConnect**: QR code connection to mobile wallets
- **Auto-Fund**: Test wallets receive 0.01 ETH + 500 OTT for testing

**Files**: `src/renderer/context/Web3Context.tsx`, `src/renderer/components/WalletButton.tsx`

### 2. Node Registration (On-Chain)
Users stake OTT tokens to register their node:
- Minimum stake: 100 OTT
- Reports hardware capabilities (CPU, RAM, GPU)
- Earns rewards for compute time

**Flow**:
1. Connect wallet
2. Approve OTT spending
3. Call `NodeRegistry.registerNode()`
4. Node gets unique `bytes32` nodeId

**Files**: `contracts/contracts/NodeRegistry.sol`, `src/renderer/components/NodeBlockchain.tsx`

### 3. Workspaces (On-Chain)
Workspaces are now fully on-chain (no central server needed):

- **Create**: Deploys workspace to blockchain
- **Public/Private**: Public = anyone joins, Private = invite code required
- **Invite Codes**: Hash stored on-chain, plaintext in localStorage
- **Join Format**: `workspaceId:INVITECODE`

**Flow**:
1. Connect wallet
2. Create workspace (gas fee ~0.001 ETH)
3. Share invite code with friends
4. They paste full code to join

**Files**:
- `contracts/contracts/WorkspaceRegistry.sol`
- `src/renderer/pages/Workspace.tsx`
- `src/renderer/context/Web3Context.tsx`

### 4. Agent Execution
ReAct-style AI agents that can:
- Use tools (file read/write, web search, code execution)
- Run in sandboxed environment
- Store results to IPFS

**Files**: `src/services/agent-service.ts`

### 5. Task Escrow
On-chain bounty system:
- Create tasks with OTT bounty
- Define milestones
- Workers apply and get assigned
- Milestone-based payments
- Dispute resolution

**Files**: `contracts/contracts/TaskEscrow.sol`

---

## API Endpoints (localhost:8080)

### Health
```
GET /health
GET /api/v1/status
```

### Wallet/Web3
```
GET  /api/v1/web3/contracts     # Get contract addresses
POST /api/v1/web3/fund-wallet   # Fund wallet with ETH + OTT (testing)
```

### Workspaces (Legacy - Local Storage)
```
GET    /api/v1/workspaces
POST   /api/v1/workspaces
POST   /api/v1/workspaces/join
GET    /api/v1/workspaces/:id
DELETE /api/v1/workspaces/:id
POST   /api/v1/workspaces/:id/leave
```

### Agents
```
GET  /api/v1/workspaces/:workspaceId/agents
POST /api/v1/workspaces/:workspaceId/agents
GET  /api/v1/workspaces/:workspaceId/agents/:agentId
```

### Ollama
```
GET  /api/v1/ollama/status
GET  /api/v1/ollama/models
POST /api/v1/ollama/pull
```

---

## Development Setup

### Prerequisites
- Node.js 18+
- npm or pnpm
- Ollama (for LLM)
- IPFS (optional)

### Install & Run
```bash
cd /mnt/d/github/node

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Build Windows installer
npx electron-builder --win
```

### Contract Development
```bash
cd contracts

# Install
npm install

# Compile
npx hardhat compile

# Deploy to Sepolia
PRIVATE_KEY=0x... npx hardhat run scripts/deploy.ts --network sepolia

# Test workspace contract
PRIVATE_KEY=0x... npx hardhat run scripts/test-workspace.ts --network sepolia
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FUNDER_PRIVATE_KEY` | Key for funding test wallets | Deployer key |
| `OLLAMA_HOST` | Ollama API endpoint | `http://localhost:11434` |
| `IPFS_API` | IPFS API endpoint | `http://localhost:5001` |

---

## Contract ABIs (Key Functions)

### OTT (ERC-20)
```solidity
function balanceOf(address) view returns (uint256)
function approve(address spender, uint256 amount) returns (bool)
function transfer(address to, uint256 amount) returns (bool)
```

### NodeRegistry
```solidity
function registerNode(Capabilities capabilities, string endpoint, uint256 stakeAmount) returns (bytes32)
function getOwnerNodes(address owner) view returns (bytes32[])
function getNode(bytes32 nodeId) view returns (NodeInfo)
function claimRewards(bytes32 nodeId)
function addStake(bytes32 nodeId, uint256 amount)
function withdrawStake(bytes32 nodeId, uint256 amount)
```

### WorkspaceRegistry
```solidity
function createWorkspace(string name, string description, bool isPublic, string inviteCode) returns (bytes32)
function joinPublicWorkspace(bytes32 workspaceId)
function joinWithInviteCode(bytes32 workspaceId, string inviteCode)
function leaveWorkspace(bytes32 workspaceId)
function getUserWorkspaces(address user) view returns (bytes32[])
function getWorkspace(bytes32 workspaceId) view returns (WorkspaceInfo)
function getPublicWorkspaces() view returns (WorkspaceInfo[])
function setInviteCode(bytes32 workspaceId, string newInviteCode)
```

### TaskEscrow
```solidity
function createTask(bytes32 workspaceId, string title, string descriptionCid, uint256 bounty, uint256 deadline, string[] milestoneDescriptions, uint256[] milestoneAmounts) returns (bytes32)
function applyForTask(bytes32 taskId, string applicationCid)
function assignWorker(bytes32 taskId, address worker)
function submitWork(bytes32 taskId, string workCid)
function approveMilestone(bytes32 taskId, uint256 milestoneIndex)
```

---

## Testing Flows

### Test Node Registration
```bash
cd contracts
PRIVATE_KEY=0x8ccc85bee32302669e4fed58d038a8373634dee36de8ae168f7cf07739b21979 \
npx hardhat run scripts/test-register.ts --network sepolia
```

### Test Workspace Creation
```bash
cd contracts
PRIVATE_KEY=0x8ccc85bee32302669e4fed58d038a8373634dee36de8ae168f7cf07739b21979 \
npx hardhat run scripts/test-workspace.ts --network sepolia
```

### Manual Testing in App
1. Start app: `npm run dev`
2. Create wallet (or import deployer key for testing)
3. Fund wallet (click "Fund Wallet" button)
4. Go to Blockchain tab, register node
5. Go to Workspaces tab, create workspace
6. Share invite code with another user

---

## Recent Changes (January 2026)

### WorkspaceRegistry Contract
- **Deployed**: `0xe409937dcc6101225952F6723Ce46ba9fDe9f6cB`
- **Features**:
  - Create workspaces on-chain
  - Public/private workspaces
  - Invite code validation (hashed on-chain)
  - Member management (Owner/Admin/Member roles)
  - Transfer ownership
  - Leave workspace

### UI Updates
- Workspace page now uses on-chain data
- Wallet connection required to view workspaces
- "ON-CHAIN" badge in UI
- Browse public workspaces modal
- Full invite code format: `workspaceId:INVITECODE`

### Wallet Features
- Create new wallet button
- Fund wallet for testing (0.01 ETH + 500 OTT)
- Sepolia faucet link in modal

---

## Known Issues / TODOs

### Current Limitations
1. **Invite codes stored locally** - If you clear localStorage, you lose plaintext codes (only hash on-chain)
2. **No P2P networking yet** - Nodes can't communicate directly without orchestrator
3. **Gas fees required** - Every on-chain action costs Sepolia ETH

### Future Improvements
1. **libp2p/WebRTC** - Direct node-to-node communication
2. **Compute verification** - Prove compute was actually done
3. **Mainnet deployment** - Move from Sepolia to Ethereum mainnet
4. **Mobile app** - React Native version

---

## Quick Reference

### Start Development
```bash
cd /mnt/d/github/node && npm run dev
```

### Deploy Contract
```bash
cd contracts
PRIVATE_KEY=0x... npx hardhat run scripts/deploy-workspace-registry.ts --network sepolia
```

### Build Windows Installer
```bash
npm run build && npx electron-builder --win
```

### Fund Test Wallet
```bash
curl -X POST http://localhost:8080/api/v1/web3/fund-wallet \
  -H "Content-Type: application/json" \
  -d '{"address": "0x..."}'
```

### Verify Contract on Etherscan
```bash
npx hardhat verify --network sepolia 0xe409937dcc6101225952F6723Ce46ba9fDe9f6cB
```

---

## Git Repository

- **Location**: `/mnt/d/github/node`
- **Branch**: `main`
- **Remote**: Check with `git remote -v`

### Recent Commits
- `feat: add on-chain WorkspaceRegistry contract`
- `fix: add missing join/leave workspace API endpoints`
- `feat: add create wallet and auto-fund for testing`

---

## Contact / Resources

- **Sepolia Faucet**: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- **Etherscan (Sepolia)**: https://sepolia.etherscan.io
- **Ollama**: https://ollama.ai
- **IPFS**: https://ipfs.io

---

## Cloud GPU Integration (January 27, 2026)

### What Was Added

**Cloud GPU rental directly from the Marketplace page** - Users can rent powerful cloud GPUs and tunnel them to their workspace for running larger models.

### Files Created/Modified

| File | Change |
|------|--------|
| `src/services/cloud-gpu-provider.ts` | **New** - Backend service for GPU rental |
| `src/renderer/components/CloudGPUPanel.tsx` | **New** - UI component |
| `src/renderer/components/index.ts` | Added CloudGPUPanel export |
| `src/api-server.ts` | Added `/api/v1/gpu/*` routes |
| `src/renderer/pages/Marketplace.tsx` | Added CloudGPUPanel to page |

### API Endpoints Added

```
POST /api/v1/gpu/configure          - Set API key
GET  /api/v1/gpu/offers             - Search GPUs (filters: maxPrice, gpuType)
GET  /api/v1/gpu/instances          - List active rentals
POST /api/v1/gpu/rent               - Rent a GPU
POST /api/v1/gpu/instances/:id/tunnel    - Create SSH tunnel
DELETE /api/v1/gpu/instances/:id/tunnel  - Disconnect
DELETE /api/v1/gpu/instances/:id         - Terminate instance
```

### How It Works

1. User enters API key (from cloud provider)
2. Browse available GPUs filtered by price/type
3. Click "Rent" to spin up instance with Ollama
4. Click "Connect" to create SSH tunnel
5. `localhost:11434` now routes to remote GPU
6. Workspace agents use the powerful remote GPU seamlessly

### Backend Provider

Uses Vast.ai marketplace but UI is branded as generic "Cloud GPU" so it can support other providers later. The API key link points to `https://cloud.vast.ai/cli/`.

### TODO

- [ ] Auto-reconnect tunnels
- [ ] Multiple provider support (RunPod, Lambda)
- [ ] Budget alerts
- [ ] Usage metrics display

---

---

## Debugging the Broken Agent Tools (January 28, 2026)

### The Problem
Agent says "tool not available" even though tools are registered. Logs show:
```
[agent] Registered local filesystem tools: local_read_file, local_list_dir, local_shell, local_find
[agent] Starting react agent for goal: ...
[agent] Iteration 1: { tool: 'local_list_dir', input: '"/home/huck/rhiz-master"' }
[agent] Iteration 2: { thought: "tool 'local_list_dir' is not available" }
```

### Debug Logging Added
File: `src/adapters/agent.ts:658-680`
```typescript
private async executeTool(toolName: string, input: string): Promise<string> {
  console.log(`[agent] Executing tool: ${toolName}, input: ${input}`);
  console.log(`[agent] Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
  // ... tool execution with cleaned input
}
```

### Possible Causes
1. **Tool map not populated** - `registerLocalTools()` called but tools not in map when agent runs
2. **Async timing** - Tools registered after agent starts
3. **Tool name mismatch** - Case sensitivity or whitespace
4. **Input parsing** - Extra quotes around input not stripped

### Files to Check
- `src/adapters/agent.ts` - Tool registration and execution
- `src/services/agent-service.ts` - Agent orchestration
- `src/adapters/adapter-manager.ts` - Adapter initialization

### The Tool Flow
```
1. sidecar.ts starts
2. AdapterManager.initialize()
3. AgentAdapter.initialize() → registerLocalTools()
4. API request creates agent
5. agentService.executeAgent()
6. agentAdapter.execute('run', request)
7. Agent calls tool → executeTool() → ???
```

### What To Check Next
1. Add `console.log(this.tools.size)` after `registerLocalTools()`
2. Add `console.log(this.tools.keys())` in `executeTool()`
3. Check if tools map is being recreated/cleared somewhere
4. Verify `this` context is correct when tools are called

---

## On-Bored Integration (January 28, 2026)

### What Was Ported
- `src/services/repo-analyzer.ts` - Core analysis logic from on-bored CLI
- `src/services/git-service.ts` - GitHub OAuth, SSH key management
- `src/renderer/components/MermaidDiagram.tsx` - Diagram rendering
- `src/renderer/components/CodebaseHealth.tsx` - Health report display
- `src/renderer/components/RepoConnectionPanel.tsx` - Repo connection UI
- `src/renderer/pages/WorkspaceCodebase.tsx` - Codebase analysis page

### What's Broken
The repo analyzer runs but only outputs basic info (README content) instead of:
- Full tech stack detection
- Dependency analysis
- Code health metrics
- Architecture diagrams (Mermaid)
- Contributor statistics

### Compare With Working Version
Original on-bored CLI: `/home/huck/on-bored`
```bash
cd /home/huck/on-bored && node bin/cli.js /path/to/repo
```

---

*Last updated: January 28, 2026*
