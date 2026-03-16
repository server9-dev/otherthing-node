# OtherThing Node — Handoff Document

## What Is This

OtherThing is a decentralized dev platform where developers complete unfinished projects via smart contract work groups with escrowed payments. This is the desktop node app (Electron) that serves as both the user interface and a compute node in the network.

## Current State (March 15, 2026)

### What's Working

**Smart Contracts (Sepolia — all deployed and verified)**
| Contract | Address | Purpose |
|---|---|---|
| OTT | `0x2013...1055` | ERC20 utility token, 1B max supply |
| NodeRegistry | `0xFaCB...e8F3` | Node staking, compute reporting, rewards |
| TaskEscrow | `0x2461...ad86` | Simple task bounty escrow (legacy) |
| WorkspaceRegistry | `0x8433...DCa` | On-chain workspaces, membership, roles |
| AgreementRegistry | `0xf5Af...7367` | Per-workspace legal agreements + signatures |
| IPRegistry | `0xBCDD...1450` | IP ownership registration per task |
| MilestoneEscrow | `0xBD29...b015` | Multi-milestone task escrow with cross-contract checks |

All 7 contracts verified on Sourcify. E2E test script at `contracts/scripts/test-e2e.ts` passes all 14 steps on Sepolia.

**Backend (Express API at localhost:8080)**
- 2900-line monolith split into 20+ route modules under `src/routes/`
- Appwrite Cloud integration with 18 collections (users, workspaces, tasks, agreements, IP, etc.)
- DataService layer wrapping local WorkspaceManager + Appwrite with dual-write and offline queue
- Chain sync service subscribing to contract events and mirroring to Appwrite
- Streaming chat endpoint (`POST /api/v1/ollama/chat`) proxying to Ollama with SSE
- Team chat endpoints (`GET/POST /api/v1/workspaces/:id/chat`)
- GitHub OAuth for repo connection (client ID/secret in `.env`)
- Auto-clone and analyze repos on connection
- IPFS auto-download binary + auto-start on first launch
- Sandbox file CRUD for workspace code editing
- Full milestone escrow lifecycle routes (create, assign, submit, approve, release, dispute)

**Frontend (React 18 + TypeScript + Vite)**
- Tabbed workspace layout with 7 tabs:
  - **Overview** — stats, quick actions, member preview
  - **Chat** — AI chat (streaming Ollama) + Team chat toggle
  - **Tasks** — Kanban board (Backlog/In Progress/Review/Done) with drag-and-drop, milestone escrow integration
  - **Code** — File tree + code editor with Ctrl+S save
  - **Files** — IPFS file browser with drag-drop upload, preview, CID copy
  - **Whiteboard** — Excalidraw with dark theme, auto-save, export PNG
  - **Members** — Member list with roles, invite code generation
- Global Task Board (`/tasks`) for cross-workspace task discovery
- Task Detail page for on-chain milestone tasks
- Wallet connection (WalletConnect QR, private key import, create new)
- Node control page with Ollama models, IPFS status, hardware detection
- Marketplace page for browsing registered compute nodes

### Architecture

```
Electron App
├── Main Process (src/main.ts)
│   ├── NodeService (hardware, ollama, ipfs, sandbox)
│   └── ApiServer (Express on :8080)
│       ├── Routes (src/routes/*.ts) — 20+ modules
│       ├── Services (appwrite, web3, data, chain-sync)
│       └── WebSocket (/ws/agents)
├── Renderer (src/renderer/)
│   ├── App.tsx + React Router
│   ├── Pages (Dashboard, Workspaces, Tasks, Node, Marketplace, Settings)
│   ├── Workspace tabs (Overview, Chat, Tasks, Code, Files, Whiteboard, Members)
│   ├── Web3Context (wallet, contracts, workspace state)
│   └── Components (CyberButton, WalletButton, panels)
└── Contracts (contracts/)
    ├── OTT, NodeRegistry, TaskEscrow, WorkspaceRegistry (deployed)
    ├── AgreementRegistry, IPRegistry, MilestoneEscrow (deployed)
    ├── Interfaces (IWorkspaceRegistry, INodeRegistry, etc.)
    └── Tests + Deploy scripts
```

### Key Files

| File | What It Does |
|---|---|
| `src/api-server.ts` | Express server + WebSocket setup (249 lines, was 2937) |
| `src/routes/index.ts` | Route aggregator, `registerAllRoutes()` |
| `src/routes/types.ts` | `RouteDependencies` interface with mutable `ManagerRefs` |
| `src/services/web3-service.ts` | All 7 contract ABIs + interaction methods |
| `src/services/appwrite-service.ts` | 18 Appwrite collections with full CRUD |
| `src/services/chain-sync.ts` | Contract event → Appwrite sync |
| `src/services/data-service.ts` | Dual-write wrapper (local + Appwrite) |
| `src/node-service.ts` | Hardware detection, Ollama/IPFS/Sandbox management |
| `src/renderer/context/Web3Context.tsx` | Frontend wallet + contract state |
| `src/renderer/pages/workspace/WorkspaceTabs.tsx` | Tabbed workspace container |
| `src/renderer/pages/workspace/ChatTab.tsx` | AI + Team chat |
| `src/renderer/pages/workspace/TasksTab.tsx` | Kanban + escrow integration |

### Environment Variables (`.env`)

```
APPWRITE_ENDPOINT=https://sfo.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=69855da10039ded42d2b
APPWRITE_API_KEY=standard_3bd7b4...
OLLAMA_HOST=http://localhost:11434
FUNDER_PRIVATE_KEY=0x8ccc85bee...
GITHUB_CLIENT_ID=Ov23lio9LlRahc5rsi79
GITHUB_CLIENT_SECRET=432ad2e2d076...
API_PORT=3001
NODE_ENV=development
```

### Test Accounts

**Funder/Owner:**
- Address: `0x683B811965A1225309e876bf82F1c6831C2311Aa`
- Private key: `0x8ccc85bee32302669e4fed58d038a8373634dee36de8ae168f7cf07739b21979`

**Worker (member of workspace 0x7f6c...):**
- Address: `0x3625F097F35aBC90a6E46d4e7f64855cce4d7580`
- Private key: `0xd3320d92f3c74a8f1d2aa33f280d0db3342f81346692265936213b21d9bdebd8`
- 500 OTT + ~0.003 ETH

### Running the App

```bash
# Dev mode (Vite HMR + Electron)
npm run dev

# Production build
npm run build && npx electron .

# Server only (headless)
npm run server
```

### Running Contract Tests

```bash
cd contracts
./node_modules/.bin/hardhat test
# 45 passing, 3 pre-existing failures in OTT.test.ts
```

### Deploying New Contracts

```bash
cd contracts
PRIVATE_KEY=<deployer-key> ./node_modules/.bin/hardhat run scripts/deploy-phase2.ts --network sepolia
```

---

## What's Left To Build

### Immediate (started but incomplete)
- **Worker task acceptance flow** — "Accept & Start Working" button calls `assignWorker()` on-chain but the full submit milestone → approve → release payment UI loop needs testing end-to-end in the app
- **Monaco editor** — Code tab uses a plain textarea. `@monaco-editor/react` is ready to install for syntax highlighting and IntelliSense
- **Persist tasks to Appwrite** — workspace tasks are in-memory and lost on restart. Need to wire task CRUD through DataService → Appwrite
- **Excalidraw in Electron** — works in browser but may white-screen in Electron due to worker/WASM issues

### Short-term
- **Milestone submit/approve/release UI in kanban** — worker submits work CID, owner approves, payment releases per milestone
- **Agreement signing UI** — show required agreements before worker can accept tasks
- **IP registration UI** — worker registers IP before final milestone payment
- **Real-time team chat via WebSocket** — currently polling every 3s, should use the existing WebSocket infrastructure
- **Task persistence** — store tasks in Appwrite instead of in-memory
- **User profiles** — profile page with wallet linking (backend routes exist, no frontend)

### Medium-term
- **Notification system** — milestone approved, payment released, new task posted
- **Reputation display** — show on-chain reputation scores on member profiles
- **Multi-workspace task discovery** — public task feed across all workspaces
- **Git integration in Code tab** — commit, push, diff from the editor
- **MCP tool integration in Chat** — let the AI use adapters (file ops, code analysis) inline
- **Cloud GPU rental** — UI exists but actions are stubbed

### Known Issues
- IPFS gateway configured on port 8180 to avoid conflict with Express on 8080
- `node-config.json` can get corrupt Windows-style paths on WSL — validation added but watch for it
- Appwrite free tier has collection limits — some Phase 1 collections may need the setup script re-run
- Pre-existing 3 test failures in `contracts/test/OTT.test.ts` (NodeRegistry tuple encoding)
- Excalidraw bundle is large (~2MB) — consider lazy loading or code splitting
- `api-bridge.ts` has `window.electronAPI = api` self-reference guard — `_originalElectronAPI` pattern prevents infinite recursion

### Dependencies Added This Session
- `@excalidraw/excalidraw` — whiteboard component
- No other new frontend dependencies (Monaco not yet installed)

### Contract Interaction Flow

```
Owner creates task (UI) → milestones + amounts stored locally
     │
Owner clicks "Escrow On-Chain" → wallet signs → MilestoneEscrow.createTask()
     │                            OTT locked in contract
     │
Worker clicks "Accept & Start Working" → MilestoneEscrow.assignWorker()
     │                                    checks NodeRegistry + AgreementRegistry
     │
Worker submits milestone work CID → MilestoneEscrow.submitMilestone()
     │
Owner approves → MilestoneEscrow.approveMilestone()
     │
Owner releases payment → MilestoneEscrow.releaseMilestonePayment()
     │                     final milestone checks IPRegistry.hasIPRegistered()
     │
Worker gets paid in OTT
```
