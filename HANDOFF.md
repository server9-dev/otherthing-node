# OtherThing Node — Handoff Document

## What Is This

OtherThing is a decentralized dev platform where developers complete unfinished projects via smart contract work groups with escrowed payments. This is the desktop node app (Electron) that serves as both the user interface and a compute node in the network.

## Current State (March 16, 2026)

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

**Backend (Express API at localhost:8080 — 188+ endpoints across 30 route files)**
- Route modules under `src/routes/` with `RouteDependencies` injection
- Appwrite Cloud integration with 18 collections
- DataService layer wrapping local WorkspaceManager + Appwrite with dual-write and offline queue
- Chain sync service subscribing to contract events and mirroring to Appwrite
- Streaming chat endpoint (`POST /api/v1/ollama/chat`) proxying to Ollama with SSE — handoff doc injected as system context when workspaceId provided
- Team chat endpoints with auto-export to IPFS every 100 messages
- GitHub OAuth for repo connection + auto-clone + analyze
- IPFS auto-download binary + auto-start on first launch
- Sandbox file CRUD for workspace code editing
- Full milestone escrow lifecycle routes
- Code-server per workspace (embedded IDE)
- WebSocket server at `/ws/agents` for agent progress + WebRTC voice/video signaling
- Cloud GPU rental (Vast.ai integration) — configure, search, rent, tunnel, terminate
- ZLayer container orchestration — deploy, scale, logs, WASM execution

**AI Services (all local via Ollama)**
- **Scheduler Service** — thin setInterval wrapper with named jobs, manual trigger
- **IPFS Export Service** — exports workspace artifacts (chat, whiteboard, transcription, digest, handoff, health-report, dispute-analysis) to IPFS. In-memory artifact index with `getArtifactsSince()` querying.
- **Transcription Service** — audio chunks from MediaRecorder per peer stream, 15s intervals, Ollama transcription, per-session aggregation, IPFS export on finalize
- **Digest Service** — 12h scheduled job. Gathers IPFS artifacts from last 12h, prompts Ollama, parses structured JSON (summary, decisions, issues, suggestedTasks). Auto-creates suggested tasks. Exports to IPFS.
- **Handoff Service** — living doc updated after each digest. Gathers digest + tasks + repos + recent decisions. Injected into AI chat as system context.
- **Health Report Service** — 48h scheduled job. Participation metrics, task velocity, AI predictions/recommendations.
- **Dispute Service** — gathers task details + workspace evidence, prompts Ollama for recommendation (release/partial/deny). Advisory only. Exports to IPFS.
- **Workspace Tools** — AI-accessible tools: update_task, create_task, list_tasks, search_chat, get_workspace_state
- **Agent Adapter** — MCP-compatible tool system with react/plan-execute/simple architectures, security scanning, semantic memory (ELID)

**Frontend (React 18 + TypeScript + Vite)**
- 11-tab workspace layout:
  - **Overview** — stats, quick actions, member preview
  - **Chat** — AI chat (streaming Ollama with workspace context) + Team chat toggle + voice/video calls with live transcription
  - **Tasks** — Kanban board with drag-and-drop, milestone escrow integration
  - **Code** — Code-server IDE embedded in iframe, repo IPFS sync
  - **Files** — IPFS file browser with drag-drop upload, preview, CID copy
  - **Whiteboard** — Excalidraw with dark theme, auto-save, export
  - **Digest** — AI-generated sprint summaries, decision tracking, suggested tasks, living handoff document
  - **Health** — Team participation metrics, task velocity, AI predictions/recommendations
  - **Preview** — Sandbox dev server with port detection and iframe embed
  - **Members** — Member list with roles, invite code generation
- Global Task Board (`/tasks`) for cross-workspace task discovery
- Task Detail page with milestone lifecycle + AI dispute analysis
- Wallet connection (WalletConnect QR, private key import, create new)
- Node control page with Ollama models, IPFS status, hardware detection

**Documentation (docs/data-flows/ — 14 files, 6400+ lines)**
- Architecture overview, developer onboarding guide
- Flow diagrams: auth, workspace, AI, escrow, storage, API catalog, compute, realtime, deployment
- Security audit guide, OWASP compliance assessment
- All with mermaid diagrams

### Architecture

```
Electron App
├── Main Process (src/main.ts)
│   ├── NodeService (hardware, ollama, ipfs, sandbox)
│   └── ApiServer (Express on :8080)
│       ├── Routes (src/routes/*.ts) — 30 modules, 188+ endpoints
│       ├── Services
│       │   ├── workspace-manager, appwrite, data, chain-sync
│       │   ├── scheduler, ipfs-export, transcription
│       │   ├── digest, handoff, dispute, health-report
│       │   └── workspace-tools, agent-service
│       ├── Adapters (agent, LLM inference — MCP compatible)
│       ├── Managers (ollama, sandbox, ipfs — mutable refs)
│       └── WebSocket (/ws/agents — signaling + progress)
├── Renderer (src/renderer/)
│   ├── App.tsx + React Router
│   ├── Pages (Dashboard, Workspaces, Tasks, Node, Marketplace, Settings)
│   ├── Workspace tabs (11 tabs — see above)
│   ├── Hooks (useVoiceVideo, useTranscription)
│   ├── Web3Context (wallet, contracts, workspace state)
│   └── Components (CyberButton, WalletButton, panels)
└── Contracts (contracts/)
    ├── 7 deployed contracts (see table above)
    ├── Interfaces (IWorkspaceRegistry, INodeRegistry, etc.)
    └── Tests + Deploy scripts
```

### Key Files

| File | What It Does |
|---|---|
| `src/api-server.ts` | Express server + WebSocket + service wiring |
| `src/routes/index.ts` | Route aggregator, `registerAllRoutes()` |
| `src/routes/types.ts` | `RouteDependencies` interface with mutable `ManagerRefs` |
| `src/routes/compute.ts` | Chat, code-server, sandbox, GPU, ZLayer (40+ endpoints) |
| `src/routes/milestones.ts` | Milestone task lifecycle (9 endpoints) |
| `src/routes/ollama.ts` | Ollama management + streaming chat with handoff injection |
| `src/services/scheduler-service.ts` | Named job scheduling with manual trigger |
| `src/services/ipfs-export-service.ts` | Artifact export to IPFS + in-memory index |
| `src/services/digest-service.ts` | 12h AI digest generation |
| `src/services/handoff-service.ts` | Living handoff document generation |
| `src/services/health-report-service.ts` | 48h team health reports |
| `src/services/dispute-service.ts` | AI dispute analysis for milestones |
| `src/services/transcription-service.ts` | Voice transcription with speaker attribution |
| `src/services/workspace-tools.ts` | AI-accessible workspace tools |
| `src/adapters/agent.ts` | Agent execution engine (1500+ lines) |
| `src/renderer/context/Web3Context.tsx` | Frontend wallet + contract state |
| `src/renderer/pages/workspace/WorkspaceTabs.tsx` | 11-tab workspace container |
| `src/renderer/pages/workspace/ChatTab.tsx` | AI + Team chat + voice/video + transcription |
| `src/renderer/pages/workspace/DigestTab.tsx` | Digest viewer + handoff document |
| `src/renderer/pages/workspace/HealthTab.tsx` | Health report metrics |
| `src/renderer/pages/TaskDetail.tsx` | Milestone task detail + AI dispute analysis |

### Environment Variables (`.env`)

```
APPWRITE_ENDPOINT=https://sfo.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=69855da10039ded42d2b
APPWRITE_API_KEY=<from .env>
OLLAMA_HOST=http://localhost:11434
FUNDER_PRIVATE_KEY=<from .env>
GITHUB_CLIENT_ID=<from .env>
GITHUB_CLIENT_SECRET=<from .env>
API_PORT=3001
NODE_ENV=development
```

### Test Accounts

**Funder/Owner:**
- Address: `0x683B811965A1225309e876bf82F1c6831C2311Aa`
- Private key: in `.env` (`FUNDER_PRIVATE_KEY`)

**Worker (member of workspace 0x7f6c...):**
- Address: `0x3625F097F35aBC90a6E46d4e7f64855cce4d7580`
- Private key: in `.env`
- 500 OTT + ~0.003 ETH

### Running the App

```bash
# Dev mode (Vite HMR + Electron)
npm run dev

# Production build
npm run build && npx electron .

# Server only (headless)
npm run server

# Seed demo data (after app is running)
bash scripts/seed-demo-data.sh
```

### Running Contract Tests

```bash
cd contracts
./node_modules/.bin/hardhat test
# 45 passing, 3 pre-existing failures in OTT.test.ts
```

---

## What's Left To Build

### Immediate (started but incomplete)
- **Persist tasks to Appwrite** — workspace tasks are in-memory and lost on restart. Need to wire task CRUD through DataService -> Appwrite
- **Real-time team chat via WebSocket** — currently polling every 3s, should use the existing WebSocket infrastructure
- **Monaco editor** — Code tab uses code-server (works) but direct Monaco integration would be lighter weight
- **IPFS daemon stability** — daemon crashes on large files and sometimes won't start. Need ulimit fixes in installer and better error recovery

### Short-term
- **Task persistence** — store tasks in Appwrite instead of in-memory
- **Notification system** — milestone approved, payment released, new task posted
- **Reputation display** — show on-chain reputation scores on member profiles
- **Git integration in Code tab** — commit, push, diff from the editor
- **MCP tool integration in Chat** — let the AI use adapters (file ops, code analysis) inline

### Medium-term
- **Mobile responsiveness** — workspace tabs don't scroll on narrow screens
- **Offline mode** — cache workspace data locally via IPFS so you can work without internet
- **Multi-workspace task discovery** — public task feed across all workspaces
- **Content moderation** — safety scanning for chat, files, media (see NCOSE compliance gap)
- **Encryption** — encrypt IPFS exports and workspace artifacts at rest

### Known Issues
- IPFS daemon exits with code 1 on startup sometimes — likely a lock file or port conflict
- IPFS gateway configured on port 8180 to avoid conflict with Express on 8080
- `node-config.json` can get corrupt Windows-style paths on WSL
- Appwrite free tier has collection limits
- Pre-existing 3 test failures in `contracts/test/OTT.test.ts`
- Excalidraw bundle is large (~2MB) — lazy loading would help
- All in-memory stores (tasks, chat, agents, transcriptions, digests, health reports) are lost on app restart

### Contract Interaction Flow

```
Owner creates task (UI) -> milestones + amounts stored locally
     |
Owner clicks "Escrow On-Chain" -> wallet signs -> MilestoneEscrow.createTask()
     |                            OTT locked in contract
     |
Worker clicks "Accept & Start Working" -> MilestoneEscrow.assignWorker()
     |                                    checks NodeRegistry + AgreementRegistry
     |
Worker submits milestone work CID -> MilestoneEscrow.submitMilestone()
     |
Owner approves -> MilestoneEscrow.approveMilestone()
     |
Owner releases payment -> MilestoneEscrow.releaseMilestonePayment()
     |                     final milestone checks IPRegistry.hasIPRegistered()
     |
Worker gets paid in OTT
```

### AI Service Flow

```
Scheduler triggers every 12h
     |
DigestService gathers IPFS artifacts (chat, transcription, whiteboard)
     |
Prompts Ollama -> parses structured JSON
     |
Creates suggested tasks + exports digest to IPFS
     |
HandoffService auto-updates living doc
     |
Handoff doc injected into AI chat as system context
```

### Seed Data Script

`scripts/seed-demo-data.sh` populates a workspace with:
- 11 tasks across all states (todo, in-progress, done, blocked)
- 41 chat messages simulating a real sprint (dev discussions, bug reports, PR reviews)
- Transcription segments from a simulated standup call
- Whiteboard architecture diagram artifact
- Triggers AI digest and health report generation

Run after app startup: `bash scripts/seed-demo-data.sh`
