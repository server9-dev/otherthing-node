# OtherThing Node - Data Flows & Architecture Documentation

> Comprehensive documentation index for OtherThing Node, a decentralized workspace platform for developers.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph ClientLayer["Client Layer"]
        direction LR
        Electron["Electron Desktop App"]
        React["React + React Router"]
        CodeServer["Code-Server IDE"]
    end

    subgraph LocalAPI["Local API Layer"]
        direction LR
        Express["Express Server :8080"]
        WS["WebSocket Server /ws/agents"]
        Routes["30 Route Files / 188+ Endpoints"]
    end

    subgraph ServiceLayer["Service Layer"]
        direction LR
        Scheduler["Scheduler"]
        IPFSExport["IPFS Export"]
        Transcription["Transcription"]
        Digest["Digest"]
        Handoff["Handoff"]
        Dispute["Dispute"]
        HealthReport["Health Report"]
        ChainSync["Chain Sync"]
    end

    subgraph ManagerLayer["Manager Pattern"]
        direction LR
        OllamaRef["ollamaManager"]
        SandboxRef["sandboxManager"]
        IPFSRef["ipfsManager"]
    end

    subgraph StorageLayer["Storage Layer"]
        direction LR
        InMemory["In-Memory Stores<br/>(Tasks, Chat, Agents)"]
        IPFS["IPFS / Kubo<br/>(Artifacts, Repos, Files)"]
    end

    subgraph AILayer["AI Layer"]
        Ollama["Ollama<br/>Local LLM Inference"]
        MCP["MCP Tool System<br/>AgentAdapter"]
    end

    subgraph BlockchainLayer["Blockchain Layer"]
        direction LR
        Ethereum["Ethereum / Sepolia"]
        Escrow["Escrow Contracts"]
        OTT["OTT Token"]
        WalletConnect["WalletConnect Auth"]
    end

    subgraph ExternalLayer["External Services"]
        direction LR
        Appwrite["Appwrite<br/>Cloud User Profiles"]
        CloudGPU["Cloud GPU<br/>Compute Marketplace"]
        ZLayer["ZLayer<br/>Container Orchestration"]
    end

    subgraph RealtimeLayer["Realtime Layer"]
        direction LR
        WebRTC["WebRTC<br/>Voice / Video"]
        Signaling["WebSocket Signaling"]
    end

    ClientLayer -->|"HTTP / IPC"| LocalAPI
    LocalAPI -->|"refs"| ManagerLayer
    LocalAPI -->|"delegates"| ServiceLayer
    ManagerLayer --> StorageLayer
    ManagerLayer --> AILayer
    ServiceLayer --> StorageLayer
    ServiceLayer --> BlockchainLayer
    LocalAPI --> RealtimeLayer
    LocalAPI --> ExternalLayer
    AILayer -->|"tool calls"| MCP

    classDef client fill:#4A90D9,stroke:#2C5F8A,color:#FFFFFF,stroke-width:2px
    classDef api fill:#7B68EE,stroke:#5A4CB5,color:#FFFFFF,stroke-width:2px
    classDef service fill:#50C878,stroke:#3A9D5C,color:#FFFFFF,stroke-width:2px
    classDef manager fill:#FF8C42,stroke:#CC6F35,color:#FFFFFF,stroke-width:2px
    classDef storage fill:#FFD700,stroke:#CCA800,color:#333333,stroke-width:2px
    classDef ai fill:#FF6B9D,stroke:#CC5580,color:#FFFFFF,stroke-width:2px
    classDef blockchain fill:#9B59B6,stroke:#7D4792,color:#FFFFFF,stroke-width:2px
    classDef external fill:#95A5A6,stroke:#7F8C8D,color:#FFFFFF,stroke-width:2px
    classDef realtime fill:#E74C3C,stroke:#C0392B,color:#FFFFFF,stroke-width:2px

    class Electron,React,CodeServer client
    class Express,WS,Routes api
    class Scheduler,IPFSExport,Transcription,Digest,Handoff,Dispute,HealthReport,ChainSync service
    class OllamaRef,SandboxRef,IPFSRef manager
    class InMemory,IPFS storage
    class Ollama,MCP ai
    class Ethereum,Escrow,OTT,WalletConnect blockchain
    class Appwrite,CloudGPU,ZLayer external
    class WebRTC,Signaling realtime
```

---

## Documentation Map

| Document | Description | Key Topics |
|----------|-------------|------------|
| [README.md](./README.md) | This file. Documentation index, high-level architecture diagram, tech stack summary. | Index, Overview, Quick Reference |
| [architecture-overview.md](./architecture-overview.md) | Comprehensive architecture deep-dive covering system design, data stores, service layer, route architecture, and manager pattern. | Architecture, Data Stores, Services, Routes, Managers, WebSocket |

### Planned Documents

| Document | Description | Status |
|----------|-------------|--------|
| `task-lifecycle.md` | Task creation through escrow, acceptance, completion, and dispute resolution. | Planned |
| `agent-execution.md` | AI agent spawning, MCP tool execution, sandbox management, and progress streaming. | Planned |
| `workspace-sync.md` | Workspace creation on-chain, member management, and chain sync service. | Planned |
| `ipfs-storage.md` | IPFS artifact pinning, repo export, file retrieval, and Kubo management. | Planned |
| `realtime-comms.md` | WebSocket message protocol, WebRTC signaling, voice/video chat flows. | Planned |
| `compute-marketplace.md` | Cloud GPU listing, ZLayer container orchestration, compute job lifecycle. | Planned |
| `auth-identity.md` | WalletConnect authentication, Appwrite profiles, workspace membership. | Planned |

---

## Tech Stack Summary

### Frontend

| Technology | Purpose | Details |
|------------|---------|---------|
| **Electron** | Desktop shell | Cross-platform desktop app, IPC to main process |
| **React** | UI framework | Component-based renderer |
| **React Router** | Navigation | Client-side routing for workspace views |
| **Code-Server** | In-browser IDE | VS Code fork, embedded in workspace |

### Backend

| Technology | Purpose | Details |
|------------|---------|---------|
| **Express** | API server | Runs on `localhost:8080`, 188+ endpoints across 30 route files |
| **WebSocket** | Realtime | Agent progress streaming, voice/video signaling at `/ws/agents` |
| **ManagerRefs** | Dependency injection | Mutable refs for `ollamaManager`, `sandboxManager`, `ipfsManager` |
| **RouteDependencies** | DI pattern | Injected into all 30 route files for consistent access |

### Storage

| Technology | Purpose | Details |
|------------|---------|---------|
| **In-Memory** | Hot data | Tasks, chat messages, agent state |
| **IPFS (Kubo)** | Decentralized storage | Artifacts, repositories, file sharing |

### AI / ML

| Technology | Purpose | Details |
|------------|---------|---------|
| **Ollama** | Local LLM inference | Managed via `ollamaManager` ref |
| **AgentAdapter** | MCP tool system | Model Context Protocol compatible tool execution |

### Blockchain

| Technology | Purpose | Details |
|------------|---------|---------|
| **Ethereum / Sepolia** | Smart contracts | Workspace registry, escrow, OTT token |
| **WalletConnect** | Authentication | Wallet-based identity and signing |
| **Chain Sync** | State sync | Polls on-chain state, updates local stores |

### Realtime

| Technology | Purpose | Details |
|------------|---------|---------|
| **WebSocket** | Signaling | Agent progress, chat, notifications |
| **WebRTC** | Peer-to-peer | Voice and video chat within workspaces |

### Compute

| Technology | Purpose | Details |
|------------|---------|---------|
| **ZLayer** | Container orchestration | Manages sandboxed execution environments |
| **Cloud GPU** | Marketplace | External compute providers for heavy workloads |

---

## Quick Reference: Directory Structure

```
otherthing-node/
├── docs/
│   └── data-flows/
│       ├── README.md                  # This file - documentation index
│       └── architecture-overview.md   # Full architecture deep-dive
├── src/
│   ├── main/                          # Electron main process
│   ├── renderer/                      # React frontend
│   │   └── pages/
│   │       └── workspace/             # Workspace views (CodeTab, etc.)
│   ├── routes/                        # 30 Express route files
│   │   ├── compute.ts                 # Compute marketplace routes
│   │   ├── repos.ts                   # Repository management routes
│   │   └── ...                        # 28 more route files
│   ├── services/                      # Background services
│   │   ├── scheduler/                 # Task scheduling
│   │   ├── chain-sync/                # Ethereum state sync
│   │   ├── ipfs-export/               # IPFS artifact export
│   │   ├── transcription/             # Audio transcription
│   │   ├── digest/                    # Activity digests
│   │   ├── handoff/                   # Task handoff logic
│   │   ├── dispute/                   # Dispute resolution
│   │   └── health-report/             # System health monitoring
│   ├── managers/                      # Manager pattern (refs)
│   │   ├── ollamaManager/             # Ollama lifecycle
│   │   ├── sandboxManager/            # Sandbox/container mgmt
│   │   └── ipfsManager/               # IPFS/Kubo lifecycle
│   └── adapters/                      # MCP-compatible adapters
│       └── AgentAdapter/              # Tool system for AI agents
├── contracts/                         # Solidity smart contracts
├── electron.vite.config.ts            # Vite config for Electron
└── package.json
```

---

## Architecture Principles

| Principle | Description |
|-----------|-------------|
| **Local-First** | Everything runs on the user's machine. No mandatory cloud dependency. |
| **Decentralized Storage** | IPFS for artifacts and files. No central file server. |
| **On-Chain Governance** | Workspaces, escrow, and tokens live on Ethereum/Sepolia. |
| **Manager Refs** | Mutable reference objects allow hot-swapping and lifecycle management of subsystems. |
| **Route Injection** | All route files receive `RouteDependencies` for uniform access to managers, stores, and services. |
| **MCP Compatibility** | AI agents use the Model Context Protocol for tool execution, enabling interoperability. |

---

*Last updated: 2026-03-16*
