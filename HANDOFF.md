# OtherThing Node - Comprehensive Handoff Document

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

*Last updated: January 25, 2026*
