# Architecture Overview

> Deep-dive into OtherThing Node's system architecture: a local-first, decentralized workspace platform for developers.

---

## System Summary

| Metric | Value |
|--------|-------|
| **API Endpoints** | 188+ |
| **Route Files** | 30 |
| **Server Port** | `localhost:8080` |
| **Desktop Runtime** | Electron |
| **Frontend Framework** | React + React Router |
| **API Framework** | Express |
| **Storage** | In-Memory + IPFS (Kubo) |
| **AI Runtime** | Ollama (local inference) |
| **Blockchain** | Ethereum / Sepolia |
| **Token** | OTT (ERC-20) |
| **Auth** | WalletConnect |
| **User Profiles** | Appwrite (cloud) |
| **Containers** | ZLayer |
| **IDE** | Code-Server (in-browser) |
| **Realtime** | WebSocket + WebRTC |
| **User Types** | Workspace Owner, Member, Worker |
| **Architecture** | Local-first, decentralized |

---

## High-Level Architecture Diagram

```mermaid
graph TB
    subgraph Desktop["Desktop Application"]
        Electron["Electron Shell"]
        MainProcess["Main Process<br/>Window Management, IPC"]

        subgraph Renderer["React Renderer"]
            Router["React Router"]
            WorkspaceUI["Workspace Views"]
            CodeTab["CodeTab Component"]
            TaskBoard["Task Board"]
            ChatUI["Chat Interface"]
            VoiceVideo["Voice/Video UI"]
            Whiteboard["Whiteboard (iframe)"]
            BalanceDisplay["OTT Balance Display"]
            ProfileUI["User Profile Views"]
        end
    end

    subgraph APIServer["Express API Server :8080"]
        ExpressApp["Express Application"]
        WSServer["WebSocket Server<br/>/ws/agents"]

        subgraph RouteLayer["Route Layer (30 files)"]
            ComputeRoutes["compute.ts"]
            RepoRoutes["repos.ts"]
            TaskRoutes["tasks.ts"]
            ChatRoutes["chat.ts"]
            AgentRoutes["agents.ts"]
            WorkspaceRoutes["workspaces.ts"]
            AuthRoutes["auth.ts"]
            IPFSRoutes["ipfs.ts"]
            EscrowRoutes["escrow.ts"]
            OtherRoutes["... 21 more route files"]
        end

        subgraph DI["Dependency Injection"]
            RouteDeps["RouteDependencies"]
        end
    end

    subgraph Managers["Manager Pattern (Mutable Refs)"]
        OllamaRef["ollamaManager<br/>Ollama lifecycle, model mgmt"]
        SandboxRef["sandboxManager<br/>Container lifecycle"]
        IPFSRef["ipfsManager<br/>Kubo daemon lifecycle"]
    end

    subgraph Services["Service Layer"]
        Scheduler["Scheduler Service<br/>Cron-like task scheduling"]
        IPFSExport["IPFS Export Service<br/>Artifact pinning & retrieval"]
        Transcription["Transcription Service<br/>Audio-to-text"]
        Digest["Digest Service<br/>Activity summaries"]
        Handoff["Handoff Service<br/>Task transition logic"]
        Dispute["Dispute Service<br/>Resolution workflows"]
        HealthReport["Health Report Service<br/>System monitoring"]
        ChainSync["Chain Sync Service<br/>Ethereum state polling"]
    end

    subgraph DataStores["Data Stores"]
        subgraph InMemory["In-Memory Stores"]
            TaskStore["Task Store"]
            ChatStore["Chat Store"]
            AgentStore["Agent Store"]
        end

        subgraph Persistent["Persistent / Decentralized"]
            IPFS["IPFS (Kubo)<br/>Artifacts, Repos, Files"]
            Blockchain["Ethereum / Sepolia<br/>Workspaces, Escrow, OTT"]
            Appwrite["Appwrite<br/>User Profiles"]
        end
    end

    subgraph AI["AI Layer"]
        Ollama["Ollama Runtime"]
        AgentAdapter["AgentAdapter<br/>MCP Tool System"]
        ToolRegistry["Tool Registry<br/>MCP-Compatible Tools"]
    end

    subgraph Realtime["Realtime Layer"]
        WSMessages["WebSocket Messages<br/>Agent progress, Chat, Notifications"]
        WebRTC["WebRTC Peers<br/>Voice & Video Streams"]
        Signaling["Signaling Protocol<br/>Offer/Answer/ICE"]
    end

    subgraph External["External Services"]
        CloudGPU["Cloud GPU Providers"]
        ZLayer["ZLayer<br/>Container Orchestration"]
        CodeServerInst["Code-Server Instance<br/>In-Browser IDE"]
    end

    %% Connections
    Electron --> MainProcess
    MainProcess -->|IPC| Renderer
    Renderer -->|HTTP| APIServer
    ExpressApp --> RouteLayer
    RouteLayer --> DI
    DI --> Managers
    DI --> Services
    Managers --> DataStores
    Services --> DataStores
    ChainSync --> Blockchain
    OllamaRef --> Ollama
    SandboxRef --> ZLayer
    IPFSRef --> IPFS
    AgentRoutes --> AgentAdapter
    AgentAdapter --> ToolRegistry
    AgentAdapter --> Ollama
    WSServer --> Realtime
    AuthRoutes -->|WalletConnect| Blockchain
    WorkspaceRoutes --> Appwrite
    ComputeRoutes --> CloudGPU

    classDef desktop fill:#4A90D9,stroke:#2C5F8A,color:#FFFFFF,stroke-width:2px
    classDef renderer fill:#5DADE2,stroke:#3498DB,color:#FFFFFF,stroke-width:2px
    classDef api fill:#7B68EE,stroke:#5A4CB5,color:#FFFFFF,stroke-width:2px
    classDef route fill:#9B8FDB,stroke:#7B68EE,color:#FFFFFF,stroke-width:1px
    classDef di fill:#A569BD,stroke:#8E44AD,color:#FFFFFF,stroke-width:2px
    classDef manager fill:#FF8C42,stroke:#CC6F35,color:#FFFFFF,stroke-width:2px
    classDef service fill:#50C878,stroke:#3A9D5C,color:#FFFFFF,stroke-width:2px
    classDef memory fill:#F4D03F,stroke:#D4AC0D,color:#333333,stroke-width:2px
    classDef persistent fill:#FFD700,stroke:#CCA800,color:#333333,stroke-width:2px
    classDef ai fill:#FF6B9D,stroke:#CC5580,color:#FFFFFF,stroke-width:2px
    classDef realtime fill:#E74C3C,stroke:#C0392B,color:#FFFFFF,stroke-width:2px
    classDef external fill:#95A5A6,stroke:#7F8C8D,color:#FFFFFF,stroke-width:2px

    class Electron,MainProcess desktop
    class Router,WorkspaceUI,CodeTab,TaskBoard,ChatUI,VoiceVideo,Whiteboard,BalanceDisplay,ProfileUI renderer
    class ExpressApp,WSServer api
    class ComputeRoutes,RepoRoutes,TaskRoutes,ChatRoutes,AgentRoutes,WorkspaceRoutes,AuthRoutes,IPFSRoutes,EscrowRoutes,OtherRoutes route
    class RouteDeps di
    class OllamaRef,SandboxRef,IPFSRef manager
    class Scheduler,IPFSExport,Transcription,Digest,Handoff,Dispute,HealthReport,ChainSync service
    class TaskStore,ChatStore,AgentStore memory
    class IPFS,Blockchain,Appwrite persistent
    class Ollama,AgentAdapter,ToolRegistry ai
    class WSMessages,WebRTC,Signaling realtime
    class CloudGPU,ZLayer,CodeServerInst external
```

---

## Technology Stack

### Frontend Technologies

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **Electron** | Desktop application shell | Wraps React renderer, manages main process, system tray, IPC |
| **React** | UI component framework | Renders all workspace views, task boards, chat, settings |
| **React Router** | Client-side routing | Navigates between workspace pages, settings, onboarding |
| **Code-Server** | Embedded IDE | VS Code fork running as iframe within workspace CodeTab |
| **Whiteboard** | Collaborative canvas | Embedded iframe component for visual collaboration |

### Backend API Technologies

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **Express** | HTTP API server | Serves 188+ endpoints on `localhost:8080` |
| **WebSocket (ws)** | Realtime messaging | Server at `/ws/agents` for bidirectional communication |
| **RouteDependencies** | Dependency injection | Injects managers, stores, services into all 30 route files |
| **ManagerRefs** | Mutable references | Hot-swappable lifecycle management for subsystems |

### Storage Technologies

| Technology | Role | Data Types | Durability |
|------------|------|------------|------------|
| **In-Memory** | Hot working data | Tasks, chat messages, agent state | Volatile (session) |
| **IPFS (Kubo)** | Decentralized storage | Artifacts, repositories, shared files | Persistent (pinned) |
| **Ethereum / Sepolia** | On-chain state | Workspaces, escrow, OTT balances | Permanent (blockchain) |
| **Appwrite** | Cloud database | User profiles, avatars, display names | Persistent (cloud) |

### AI / ML Technologies

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **Ollama** | Local LLM inference | Managed by `ollamaManager`, serves model completions |
| **AgentAdapter** | MCP tool bridge | Translates agent tool calls into system actions |
| **MCP Protocol** | Tool interoperability | Model Context Protocol for standardized tool definitions |

### Blockchain Technologies

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **Ethereum** | Smart contract platform | Hosts workspace registry, escrow, OTT token contracts |
| **Sepolia Testnet** | Development chain | Testing environment for all on-chain operations |
| **WalletConnect** | Wallet authentication | Connects user wallets for signing and identity |
| **OTT Token** | Platform currency | ERC-20 token for escrow, payments, compute marketplace |

### Realtime Technologies

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **WebSocket** | Server-push messaging | Agent progress updates, chat messages, notifications |
| **WebRTC** | Peer-to-peer media | Voice and video streams between workspace members |
| **Signaling** | WebRTC negotiation | Offer/answer/ICE candidate exchange over WebSocket |

### Compute Technologies

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **ZLayer** | Container orchestration | Manages sandboxed environments for agent execution |
| **Cloud GPU** | External compute | Marketplace for GPU-accelerated workloads |
| **Code-Server** | Development environment | In-browser VS Code for workspace code editing |

---

## Directory Structure

```
otherthing-node/
├── docs/
│   └── data-flows/
│       ├── README.md                      # Documentation index
│       └── architecture-overview.md       # This file
│
├── src/
│   ├── main/                              # Electron main process
│   │   ├── index.ts                       # App entry point, window creation
│   │   └── ...                            # IPC handlers, tray, auto-update
│   │
│   ├── renderer/                          # React frontend
│   │   ├── App.tsx                        # Root component, router setup
│   │   ├── pages/
│   │   │   └── workspace/
│   │   │       ├── CodeTab.tsx            # Code-server IDE integration
│   │   │       ├── TaskBoard.tsx          # Task management UI
│   │   │       ├── Chat.tsx               # Real-time chat interface
│   │   │       ├── VoiceVideo.tsx         # WebRTC voice/video
│   │   │       ├── Whiteboard.tsx         # Collaborative whiteboard
│   │   │       └── ...                    # Other workspace views
│   │   └── components/                    # Shared UI components
│   │
│   ├── routes/                            # Express route files (30 total)
│   │   ├── agents.ts                      # AI agent management
│   │   ├── auth.ts                        # WalletConnect authentication
│   │   ├── chat.ts                        # Chat messaging
│   │   ├── compute.ts                     # Compute marketplace
│   │   ├── escrow.ts                      # Escrow operations
│   │   ├── ipfs.ts                        # IPFS file operations
│   │   ├── repos.ts                       # Repository management
│   │   ├── tasks.ts                       # Task CRUD & lifecycle
│   │   ├── workspaces.ts                  # Workspace management
│   │   └── ...                            # 21 additional route files
│   │
│   ├── services/                          # Background services
│   │   ├── scheduler/                     # Cron-like task scheduling
│   │   ├── chain-sync/                    # Ethereum state synchronization
│   │   ├── ipfs-export/                   # IPFS artifact export & pinning
│   │   ├── transcription/                 # Audio-to-text processing
│   │   ├── digest/                        # Activity summary generation
│   │   ├── handoff/                       # Task ownership transitions
│   │   ├── dispute/                       # Dispute resolution workflows
│   │   └── health-report/                 # System health monitoring
│   │
│   ├── managers/                          # Manager pattern implementations
│   │   ├── ollamaManager/                 # Ollama process lifecycle
│   │   ├── sandboxManager/                # Container/sandbox lifecycle
│   │   └── ipfsManager/                   # Kubo daemon lifecycle
│   │
│   └── adapters/                          # External system adapters
│       └── AgentAdapter/                  # MCP-compatible tool system
│
├── contracts/                             # Solidity smart contracts
│   ├── WorkspaceRegistry.sol              # On-chain workspace creation
│   ├── Escrow.sol                         # Task escrow logic
│   └── OTTToken.sol                       # ERC-20 OTT token
│
├── electron.vite.config.ts                # Vite build config for Electron
└── package.json                           # Dependencies and scripts
```

---

## User Roles

```mermaid
graph LR
    subgraph Roles["User Roles"]
        Owner["Workspace Owner"]
        Member["Workspace Member"]
        Worker["Task Worker"]
    end

    subgraph OwnerPerms["Owner Capabilities"]
        CreateWS["Create Workspace (on-chain)"]
        InviteMembers["Invite Members"]
        CreateTasks["Create & Assign Tasks"]
        FundEscrow["Fund Escrow with OTT"]
        ManageSettings["Manage Workspace Settings"]
        DisputeResolution["Initiate Disputes"]
    end

    subgraph MemberPerms["Member Capabilities"]
        ViewTasks["View Task Board"]
        Chat["Participate in Chat"]
        VoiceVideoCall["Join Voice/Video"]
        UseIDE["Use Code-Server IDE"]
        UseWhiteboard["Use Whiteboard"]
        ViewBalance["View OTT Balance"]
    end

    subgraph WorkerPerms["Worker Capabilities"]
        AcceptTask["Accept Escrowed Tasks"]
        SubmitWork["Submit Deliverables"]
        ReceivePayment["Receive OTT Payment"]
        HandoffTask["Hand Off Tasks"]
    end

    Owner --> OwnerPerms
    Member --> MemberPerms
    Worker --> WorkerPerms

    Owner -.->|"inherits"| MemberPerms
    Worker -.->|"inherits"| MemberPerms

    classDef role fill:#4A90D9,stroke:#2C5F8A,color:#FFFFFF,stroke-width:2px
    classDef ownerPerm fill:#9B59B6,stroke:#7D4792,color:#FFFFFF,stroke-width:1px
    classDef memberPerm fill:#50C878,stroke:#3A9D5C,color:#FFFFFF,stroke-width:1px
    classDef workerPerm fill:#FF8C42,stroke:#CC6F35,color:#FFFFFF,stroke-width:1px

    class Owner,Member,Worker role
    class CreateWS,InviteMembers,CreateTasks,FundEscrow,ManageSettings,DisputeResolution ownerPerm
    class ViewTasks,Chat,VoiceVideoCall,UseIDE,UseWhiteboard,ViewBalance memberPerm
    class AcceptTask,SubmitWork,ReceivePayment,HandoffTask workerPerm
```

---

## Data Stores

### Store Architecture

```mermaid
graph TB
    subgraph InMemory["In-Memory Stores (Volatile)"]
        TaskStore["Task Store<br/>─────────────<br/>Tasks with status, assignee,<br/>escrow state, deliverables"]
        ChatStore["Chat Store<br/>─────────────<br/>Messages per workspace,<br/>sender, timestamp, thread"]
        AgentStore["Agent Store<br/>─────────────<br/>Running agents, progress,<br/>tool calls, outputs"]
    end

    subgraph IPFSStore["IPFS via Kubo (Decentralized)"]
        Artifacts["Artifacts<br/>─────────────<br/>Build outputs, binaries,<br/>compiled assets"]
        Repos["Repositories<br/>─────────────<br/>Git repo snapshots,<br/>source archives"]
        SharedFiles["Shared Files<br/>─────────────<br/>Documents, images,<br/>attachments"]
    end

    subgraph ChainStore["Blockchain (Ethereum/Sepolia)"]
        Workspaces["Workspace Registry<br/>─────────────<br/>Workspace ID, owner,<br/>member list, metadata"]
        Escrow["Escrow Contracts<br/>─────────────<br/>Task ID, funder, worker,<br/>OTT amount, status"]
        OTTToken["OTT Token<br/>─────────────<br/>Balances, allowances,<br/>transfer history"]
    end

    subgraph CloudStore["Appwrite (Cloud)"]
        Profiles["User Profiles<br/>─────────────<br/>Display name, avatar,<br/>bio, wallet address"]
    end

    APIServer["Express API :8080"] --> InMemory
    APIServer --> IPFSStore
    APIServer --> ChainStore
    APIServer --> CloudStore

    ChainSync["Chain Sync Service"] -->|"polls"| ChainStore
    ChainSync -->|"updates"| InMemory

    IPFSExport["IPFS Export Service"] -->|"pins"| IPFSStore

    classDef inmem fill:#F4D03F,stroke:#D4AC0D,color:#333333,stroke-width:2px
    classDef ipfs fill:#48C9B0,stroke:#1ABC9C,color:#FFFFFF,stroke-width:2px
    classDef chain fill:#9B59B6,stroke:#7D4792,color:#FFFFFF,stroke-width:2px
    classDef cloud fill:#5DADE2,stroke:#3498DB,color:#FFFFFF,stroke-width:2px
    classDef server fill:#7B68EE,stroke:#5A4CB5,color:#FFFFFF,stroke-width:2px
    classDef svc fill:#50C878,stroke:#3A9D5C,color:#FFFFFF,stroke-width:2px

    class TaskStore,ChatStore,AgentStore inmem
    class Artifacts,Repos,SharedFiles ipfs
    class Workspaces,Escrow,OTTToken chain
    class Profiles cloud
    class APIServer server
    class ChainSync,IPFSExport svc
```

### Store Details

| Store | Type | Contents | Lifecycle |
|-------|------|----------|-----------|
| **Task Store** | In-Memory | Task ID, title, description, status, assignee, escrow reference, deliverables | Created on task creation, persists for session |
| **Chat Store** | In-Memory | Message ID, workspace ID, sender, content, timestamp, thread ID | Accumulated during session |
| **Agent Store** | In-Memory | Agent ID, model, status, tool calls log, progress %, output | Created on agent spawn, cleared on completion |
| **IPFS Artifacts** | IPFS (Kubo) | CID-addressed build outputs, compiled assets, binary artifacts | Pinned until unpinned |
| **IPFS Repos** | IPFS (Kubo) | Git repository snapshots, source code archives | Pinned on export |
| **IPFS Files** | IPFS (Kubo) | Shared documents, images, attachments uploaded by members | Pinned on upload |
| **Workspace Registry** | Ethereum | Workspace ID, owner address, member addresses, metadata hash | Permanent (on-chain) |
| **Escrow** | Ethereum | Task ID, funder address, worker address, OTT amount, escrow status | Permanent (on-chain) |
| **OTT Token** | Ethereum | ERC-20 balances, allowances, transfer events | Permanent (on-chain) |
| **User Profiles** | Appwrite | Display name, avatar URL, bio, linked wallet address | Persistent (cloud) |

---

## Service Layer

```mermaid
graph TB
    subgraph ServiceLayer["Service Layer"]
        subgraph Scheduling["Task & Scheduling"]
            Scheduler["Scheduler Service<br/>─────────────<br/>Periodic job execution<br/>Cron-like scheduling<br/>Task deadline monitoring"]
        end

        subgraph Storage["Storage Services"]
            IPFSExport["IPFS Export Service<br/>─────────────<br/>Pin artifacts to IPFS<br/>Export repos as archives<br/>Retrieve by CID"]
        end

        subgraph Processing["Processing Services"]
            Transcription["Transcription Service<br/>─────────────<br/>Audio-to-text conversion<br/>Meeting transcriptions<br/>Voice note processing"]
            Digest["Digest Service<br/>─────────────<br/>Activity summaries<br/>Daily/weekly digests<br/>AI-generated overviews"]
        end

        subgraph TaskMgmt["Task Management"]
            Handoff["Handoff Service<br/>─────────────<br/>Task ownership transfer<br/>Worker acceptance flow<br/>Completion verification"]
            Dispute["Dispute Service<br/>─────────────<br/>Resolution workflows<br/>Evidence collection<br/>Arbitration logic"]
        end

        subgraph Monitoring["Monitoring"]
            HealthReport["Health Report Service<br/>─────────────<br/>System status checks<br/>Manager health polling<br/>Resource usage tracking"]
        end

        subgraph Blockchain["Blockchain Sync"]
            ChainSync["Chain Sync Service<br/>─────────────<br/>Poll Ethereum/Sepolia<br/>Sync workspace state<br/>Track escrow changes<br/>Update OTT balances"]
        end
    end

    Express["Express API"] --> Scheduler
    Express --> IPFSExport
    Express --> Transcription
    Express --> Digest
    Express --> Handoff
    Express --> Dispute
    Express --> HealthReport
    Express --> ChainSync

    Scheduler -->|"triggers"| Handoff
    Scheduler -->|"triggers"| Digest
    ChainSync -->|"updates"| Handoff
    Handoff -->|"may trigger"| Dispute

    classDef svc fill:#50C878,stroke:#3A9D5C,color:#FFFFFF,stroke-width:2px
    classDef api fill:#7B68EE,stroke:#5A4CB5,color:#FFFFFF,stroke-width:2px

    class Scheduler,IPFSExport,Transcription,Digest,Handoff,Dispute,HealthReport,ChainSync svc
    class Express api
```

### Service Responsibilities

| Service | Trigger | Input | Output | Dependencies |
|---------|---------|-------|--------|-------------|
| **Scheduler** | Timer / Cron | Schedule configuration | Job execution | All other services |
| **IPFS Export** | API call / Service | File data, repo path | IPFS CID | `ipfsManager` |
| **Transcription** | API call | Audio buffer/file | Text transcript | `ollamaManager` (optional) |
| **Digest** | Scheduler / API | Workspace activity data | Summary text | Chat Store, Task Store, `ollamaManager` |
| **Handoff** | API call / Chain Sync | Task ID, new worker | Updated task state | Task Store, Escrow |
| **Dispute** | API call | Task ID, evidence | Resolution outcome | Escrow, Task Store |
| **Health Report** | Scheduler / API | System state | Health status JSON | All managers |
| **Chain Sync** | Scheduler (polling) | Ethereum RPC | Updated local state | Task Store, Blockchain |

---

## Manager Pattern

The Manager Pattern uses mutable reference objects (`ManagerRefs`) to encapsulate the lifecycle of external subsystems. Each manager controls starting, stopping, health-checking, and interfacing with its respective subsystem.

```mermaid
graph TB
    subgraph ManagerRefs["ManagerRefs (Mutable References)"]
        OllamaRef["ollamaManager<br/>─────────────<br/>.start() / .stop()<br/>.isRunning()<br/>.getClient()<br/>.listModels()<br/>.pullModel()"]
        SandboxRef["sandboxManager<br/>─────────────<br/>.start() / .stop()<br/>.isRunning()<br/>.createSandbox()<br/>.destroySandbox()<br/>.execInSandbox()"]
        IPFSRef["ipfsManager<br/>─────────────<br/>.start() / .stop()<br/>.isRunning()<br/>.add() / .get()<br/>.pin() / .unpin()<br/>.stat()"]
    end

    subgraph ExternalSystems["External Systems"]
        Ollama["Ollama Process<br/>(Local LLM Server)"]
        ZLayer["ZLayer Containers<br/>(Sandboxed Execution)"]
        Kubo["Kubo Daemon<br/>(IPFS Node)"]
    end

    OllamaRef -->|"manages lifecycle"| Ollama
    SandboxRef -->|"manages lifecycle"| ZLayer
    IPFSRef -->|"manages lifecycle"| Kubo

    RouteDeps["RouteDependencies"] -->|"injects refs"| OllamaRef
    RouteDeps -->|"injects refs"| SandboxRef
    RouteDeps -->|"injects refs"| IPFSRef

    Routes["Route Files (30)"] -->|"receives"| RouteDeps
    Services["Service Layer"] -->|"receives"| RouteDeps

    classDef manager fill:#FF8C42,stroke:#CC6F35,color:#FFFFFF,stroke-width:2px
    classDef external fill:#95A5A6,stroke:#7F8C8D,color:#FFFFFF,stroke-width:2px
    classDef di fill:#A569BD,stroke:#8E44AD,color:#FFFFFF,stroke-width:2px
    classDef consumer fill:#5DADE2,stroke:#3498DB,color:#FFFFFF,stroke-width:2px

    class OllamaRef,SandboxRef,IPFSRef manager
    class Ollama,ZLayer,Kubo external
    class RouteDeps di
    class Routes,Services consumer
```

### Why Mutable Refs?

| Concern | Solution |
|---------|----------|
| **Hot restart** | Managers can `.stop()` and `.start()` without restarting the Express server |
| **Lazy initialization** | Subsystems start on first use, not at boot |
| **Health monitoring** | `.isRunning()` allows health checks without coupling |
| **Testability** | Refs can be swapped with mocks in tests |
| **Graceful degradation** | If a manager fails, other subsystems continue operating |

---

## Route Architecture

### RouteDependencies Injection

All 30 route files receive a single `RouteDependencies` object that provides access to every shared resource:

```mermaid
graph LR
    subgraph RouteDependencies["RouteDependencies Object"]
        Managers["managers:<br/>ollamaManager<br/>sandboxManager<br/>ipfsManager"]
        Stores["stores:<br/>taskStore<br/>chatStore<br/>agentStore"]
        ServicesRef["services:<br/>scheduler<br/>chainSync<br/>ipfsExport<br/>..."]
        Config["config:<br/>port, chain, keys"]
        WSRef["ws:<br/>WebSocket server ref"]
    end

    subgraph RouteFiles["Route Files (30)"]
        R1["agents.ts"]
        R2["auth.ts"]
        R3["chat.ts"]
        R4["compute.ts"]
        R5["escrow.ts"]
        R6["ipfs.ts"]
        R7["repos.ts"]
        R8["tasks.ts"]
        R9["workspaces.ts"]
        R10["... 21 more"]
    end

    RouteDependencies -->|"injected into"| R1
    RouteDependencies -->|"injected into"| R2
    RouteDependencies -->|"injected into"| R3
    RouteDependencies -->|"injected into"| R4
    RouteDependencies -->|"injected into"| R5
    RouteDependencies -->|"injected into"| R6
    RouteDependencies -->|"injected into"| R7
    RouteDependencies -->|"injected into"| R8
    RouteDependencies -->|"injected into"| R9
    RouteDependencies -->|"injected into"| R10

    classDef deps fill:#A569BD,stroke:#8E44AD,color:#FFFFFF,stroke-width:2px
    classDef route fill:#9B8FDB,stroke:#7B68EE,color:#FFFFFF,stroke-width:1px

    class Managers,Stores,ServicesRef,Config,WSRef deps
    class R1,R2,R3,R4,R5,R6,R7,R8,R9,R10 route
```

### Route File Categories

| Category | Route Files | Endpoint Count (est.) | Description |
|----------|------------|----------------------|-------------|
| **Core Workspace** | `workspaces.ts`, `auth.ts` | ~20 | Workspace CRUD, membership, WalletConnect auth |
| **Task Management** | `tasks.ts`, `escrow.ts`, `handoff.ts` | ~25 | Task lifecycle, escrow funding, worker acceptance |
| **AI & Agents** | `agents.ts`, `models.ts` | ~20 | Agent spawning, progress, model management |
| **Communication** | `chat.ts`, `voice.ts`, `notifications.ts` | ~15 | Messaging, voice/video, push notifications |
| **Storage** | `ipfs.ts`, `repos.ts`, `files.ts` | ~25 | IPFS operations, git repos, file uploads |
| **Compute** | `compute.ts`, `sandbox.ts` | ~20 | GPU marketplace, container management |
| **Profiles** | `profiles.ts`, `settings.ts` | ~15 | Appwrite profiles, user preferences |
| **System** | `health.ts`, `config.ts`, `debug.ts` | ~10 | Health checks, configuration, debugging |
| **Other** | 14+ additional route files | ~38 | Remaining domain-specific endpoints |

---

## WebSocket Message Types

The WebSocket server at `/ws/agents` handles multiple message categories:

```mermaid
graph TB
    subgraph Client["Client (Renderer)"]
        ReactApp["React Application"]
    end

    subgraph WSServer["WebSocket Server /ws/agents"]
        Handler["Message Router"]
    end

    subgraph MessageTypes["Message Categories"]
        subgraph AgentMessages["Agent Messages"]
            AgentProgress["agent:progress<br/>─────────────<br/>Progress %, current step,<br/>tool being executed"]
            AgentComplete["agent:complete<br/>─────────────<br/>Final output, artifacts,<br/>execution summary"]
            AgentError["agent:error<br/>─────────────<br/>Error details, stack trace,<br/>recovery suggestions"]
            AgentToolCall["agent:tool_call<br/>─────────────<br/>Tool name, arguments,<br/>result preview"]
        end

        subgraph ChatMessages["Chat Messages"]
            ChatNew["chat:message<br/>─────────────<br/>New message in workspace,<br/>sender, content, thread"]
            ChatTyping["chat:typing<br/>─────────────<br/>Typing indicator,<br/>user, workspace"]
        end

        subgraph SignalingMessages["Voice/Video Signaling"]
            Offer["signal:offer<br/>─────────────<br/>WebRTC SDP offer<br/>from caller"]
            Answer["signal:answer<br/>─────────────<br/>WebRTC SDP answer<br/>from callee"]
            ICE["signal:ice<br/>─────────────<br/>ICE candidate<br/>for NAT traversal"]
            Join["signal:join<br/>─────────────<br/>User joining voice/video<br/>room"]
            Leave["signal:leave<br/>─────────────<br/>User leaving voice/video<br/>room"]
        end

        subgraph SystemMessages["System Messages"]
            HealthUpdate["system:health<br/>─────────────<br/>Manager status changes,<br/>resource warnings"]
            Notification["system:notification<br/>─────────────<br/>Task updates, escrow events,<br/>member joins"]
        end
    end

    ReactApp <-->|"ws://localhost:8080/ws/agents"| Handler
    Handler --> AgentMessages
    Handler --> ChatMessages
    Handler --> SignalingMessages
    Handler --> SystemMessages

    classDef client fill:#4A90D9,stroke:#2C5F8A,color:#FFFFFF,stroke-width:2px
    classDef server fill:#7B68EE,stroke:#5A4CB5,color:#FFFFFF,stroke-width:2px
    classDef agent fill:#FF6B9D,stroke:#CC5580,color:#FFFFFF,stroke-width:1px
    classDef chat fill:#50C878,stroke:#3A9D5C,color:#FFFFFF,stroke-width:1px
    classDef signal fill:#E74C3C,stroke:#C0392B,color:#FFFFFF,stroke-width:1px
    classDef system fill:#F4D03F,stroke:#D4AC0D,color:#333333,stroke-width:1px

    class ReactApp client
    class Handler server
    class AgentProgress,AgentComplete,AgentError,AgentToolCall agent
    class ChatNew,ChatTyping chat
    class Offer,Answer,ICE,Join,Leave signal
    class HealthUpdate,Notification system
```

### Message Protocol

| Direction | Message Type | Payload | Purpose |
|-----------|-------------|---------|---------|
| Server -> Client | `agent:progress` | `{ agentId, progress, step, tool }` | Stream agent execution progress |
| Server -> Client | `agent:complete` | `{ agentId, output, artifacts[] }` | Agent finished execution |
| Server -> Client | `agent:error` | `{ agentId, error, recoverable }` | Agent execution failed |
| Server -> Client | `agent:tool_call` | `{ agentId, tool, args, result }` | Agent invoked a tool |
| Bidirectional | `chat:message` | `{ workspaceId, sender, content, ts }` | New chat message |
| Client -> Server | `chat:typing` | `{ workspaceId, userId }` | Typing indicator |
| Client -> Server | `signal:offer` | `{ targetId, sdp }` | WebRTC offer |
| Client -> Server | `signal:answer` | `{ targetId, sdp }` | WebRTC answer |
| Bidirectional | `signal:ice` | `{ targetId, candidate }` | ICE candidate exchange |
| Client -> Server | `signal:join` | `{ workspaceId, userId }` | Join voice/video room |
| Client -> Server | `signal:leave` | `{ workspaceId, userId }` | Leave voice/video room |
| Server -> Client | `system:health` | `{ managers: { ... } }` | Health status change |
| Server -> Client | `system:notification` | `{ type, data }` | System notifications |

---

## Key Files Reference

| File | Purpose | Layer |
|------|---------|-------|
| `src/main/index.ts` | Electron main process entry point | Desktop |
| `src/renderer/App.tsx` | React root component with router | Frontend |
| `src/renderer/pages/workspace/CodeTab.tsx` | Code-server IDE integration | Frontend |
| `src/routes/compute.ts` | Compute marketplace API endpoints | API |
| `src/routes/repos.ts` | Repository management API endpoints | API |
| `src/routes/tasks.ts` | Task lifecycle API endpoints | API |
| `src/routes/agents.ts` | AI agent management API endpoints | API |
| `src/routes/escrow.ts` | Escrow operations API endpoints | API |
| `src/managers/ollamaManager/` | Ollama process lifecycle management | Manager |
| `src/managers/sandboxManager/` | Container/sandbox lifecycle management | Manager |
| `src/managers/ipfsManager/` | Kubo/IPFS daemon lifecycle management | Manager |
| `src/services/scheduler/` | Cron-like job scheduling | Service |
| `src/services/chain-sync/` | Ethereum state synchronization | Service |
| `src/services/handoff/` | Task ownership transfer logic | Service |
| `src/services/dispute/` | Dispute resolution workflows | Service |
| `src/adapters/AgentAdapter/` | MCP-compatible tool system | Adapter |
| `contracts/` | Solidity smart contracts | Blockchain |
| `electron.vite.config.ts` | Build configuration | Config |

---

## Request Flow

A typical request through the system:

```mermaid
sequenceDiagram
    participant User as User (React UI)
    participant Router as React Router
    participant API as Express API :8080
    participant Deps as RouteDependencies
    participant Manager as Manager (Ref)
    participant Store as Data Store
    participant External as External System
    participant WS as WebSocket

    User->>Router: Navigate / interact
    Router->>API: HTTP request
    API->>Deps: Extract dependencies
    Deps->>Manager: Access manager ref
    Manager->>External: Delegate to subsystem
    External-->>Manager: Result
    Manager-->>API: Response data
    API->>Store: Update state
    API-->>User: HTTP response
    API->>WS: Broadcast update
    WS-->>User: Real-time notification
```

---

*Last updated: 2026-03-16*
