# OtherThing Node

> **A decentralized workspace platform for P2P compute, AI agents, and collaborative development with blockchain-backed payments and IP protection.**

Desktop + headless application for the OtherThing network. Run local AI models, share compute resources, collaborate in workspaces, and get paid via smart contracts.

**Live API: https://api.otherthing.ai**

## Install (Linux)

One-line installer — handles all dependencies automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/server9-dev/otherthing-node/main/install.sh | bash
```

The installer checks for and installs (if missing):
- **Node.js** (v18+)
- **Ollama** — local AI model inference
- **IPFS** (Kubo) — distributed file storage
- **code-server** — VS Code editor in workspaces
- **Build tools** — gcc, make, python3, Electron dependencies (GTK, NSS, etc.)
- **npm packages** — app + smart contract dependencies
- Desktop launcher entry

Already have some of these? The installer detects existing installations and skips them.

### Manual Install

```bash
git clone https://github.com/server9-dev/otherthing-node.git
cd otherthing-node
npm install
cp .env.example .env  # Configure credentials
npm run dev            # Development mode
npm start              # Production mode
```

### Headless Server (WSL/Docker/CLI)

```bash
npm install
cp .env.example .env
npm run server         # API at http://localhost:8080
```

## What It Does

OtherThing lets teams collaborate on projects with:
- **Workspace Voice/Video Chat** — WebRTC-based calls with team members
- **Shared AI Agents** — Run tasks using local or distributed LLMs
- **Code Editor** — Full VS Code (code-server) embedded in workspaces with pop-out
- **Whiteboard** — Excalidraw embedded with pop-out support
- **P2P Compute** — Share CPU/GPU resources across the network
- **Smart Contracts** — Escrow payments, milestone releases, OTT treasury
- **Enterprise Architecture** — UAF framework for systems modeling
- **Sandboxed Execution** — Isolated code execution with container/WASM support

## Current Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Desktop** | Electron + React | Cross-platform app with embedded tools |
| **Backend** | Appwrite Cloud | Users, workspaces, UAF elements, contracts |
| **API** | Express + WebSocket | REST API + real-time streaming + WebRTC signaling |
| **AI** | Ollama | Local LLM inference (Llama, Mistral, Qwen, etc.) |
| **Editor** | code-server | VS Code in workspaces (MIT licensed) |
| **Whiteboard** | Excalidraw | Collaborative drawing |
| **Memory** | ELID | Semantic search without vector DB |
| **Containers** | ZLayer | Daemonless orchestration + WASM |
| **Storage** | IPFS | Distributed file storage |
| **Blockchain** | Ethereum (Sepolia) | OTT token, escrow, node registry, treasury |
| **CDN/Tunnel** | Cloudflare | Public API at api.otherthing.ai |

## Configuration

Create a `.env` file (see `.env.example`):

```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-api-key
OLLAMA_HOST=http://localhost:11434
```

### Appwrite Setup

Run the setup script to create database collections:
```bash
APPWRITE_PROJECT_ID=xxx APPWRITE_API_KEY=xxx npx ts-node src/services/appwrite-setup.ts
```

This creates collections for: workspaces, flows, UAF elements, relationships, smart contracts, and compute jobs.

## API Endpoints

### Core
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/workspaces` | GET/POST | List/create workspaces |
| `/api/v1/workspaces/:id` | GET/PUT/DELETE | Workspace CRUD |

### AI Agents
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/agents/run` | POST | Execute an AI agent |
| `/api/v1/ollama/status` | GET | Ollama status and models |
| `/api/v1/ollama/pull` | POST | Pull a model |
| `ws://localhost:8080/ws/agents` | WS | Real-time agent streaming + WebRTC signaling |

### Workspace Tools
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/workspaces/:id/code-server` | POST/GET/DELETE | Start/check/stop code-server |
| `/api/v1/workspaces/:id/chat` | GET/POST | Team chat messages |
| `/api/v1/workspaces/:id/sandbox/files` | GET/POST | File operations |
| `/api/v1/workspaces/:id/sandbox/execute` | POST | Run shell command |

### UAF (Architecture Framework)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/workspaces/:id/uaf/elements` | GET/POST | UAF elements CRUD |
| `/api/v1/workspaces/:id/uaf/relationships` | GET/POST | Element relationships |
| `/api/v1/workspaces/:id/uaf/grid` | GET | 11x14 UAF grid view |
| `/api/v1/workspaces/:id/uaf/views` | POST | Generate Mermaid diagrams |
| `/api/v1/workspaces/:id/uaf/stats` | GET | Architecture statistics |
| `/api/v1/workspaces/:id/uaf/export` | GET | Export to JSON |

### Semantic Memory
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/memory/:workspaceId/store` | POST | Store a memory |
| `/api/v1/memory/:workspaceId/search` | POST | Semantic search |
| `/api/v1/memory/:workspaceId/recent` | GET | Recent memories |

### ZLayer (Containers)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/zlayer/status` | GET | ZLayer status |
| `/api/v1/zlayer/services` | GET | List services |
| `/api/v1/zlayer/deploy` | POST | Deploy a service |
| `/api/v1/zlayer/wasm/run` | POST | Execute WASM module |

### Treasury
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/treasury/stats` | GET | Treasury statistics |

## Agent Tools

Agents have access to these tools:

**Filesystem**: `read_file`, `write_file`, `list_dir`, `search_files`, `shell`

**Memory**: `memory_store`, `memory_search`, `memory_recent`, `memory_stats`

**UAF**: `uaf_create_element`, `uaf_query_elements`, `uaf_link_elements`, `uaf_generate_view`, `uaf_stats`, `uaf_export`

## Smart Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| OTT Token | `0x201333A5C882751a98E483f9B763DF4D8e5A1055` |
| NodeRegistry | `0xFaCB01A565ea526FC8CAC87D5D4622983735e8F3` |
| TaskEscrow | `0x246127F9743AC938baB7fc221546a785C880ad86` |

## Project Structure

```
src/
├── main.ts              # Electron main process
├── server.ts            # Headless server entry
├── api-server.ts        # REST/WebSocket/WebRTC signaling
├── node-service.ts      # Core node functionality
├── ollama-manager.ts    # Ollama LLM integration
├── sandbox-manager.ts   # Code execution sandbox
├── ipfs-manager.ts      # IPFS storage
├── adapters/
│   ├── agent.ts         # AI agent with tools
│   └── llm-inference.ts # LLM adapter
├── services/
│   ├── appwrite-service.ts   # Appwrite backend
│   ├── uaf-service.ts        # UAF CRUD operations
│   ├── semantic-memory.ts    # ELID-based memory
│   ├── zlayer-service.ts     # Container orchestration
│   ├── web3-service.ts       # Blockchain integration
│   └── workspace-manager.ts  # Workspace management
├── routes/
│   ├── compute.ts       # Sandbox, chat, code-server, hardware
│   ├── treasury.ts      # OTT treasury endpoints
│   └── ...              # Other route modules
└── renderer/
    ├── App.tsx           # Main app shell with OTT balance display
    ├── hooks/
    │   └── useVoiceVideo.ts  # WebRTC voice/video hook
    ├── pages/
    │   ├── workspace/
    │   │   ├── ChatTab.tsx       # AI + team chat with voice/video
    │   │   ├── CodeTab.tsx       # code-server iframe editor
    │   │   ├── WhiteboardTab.tsx # Excalidraw iframe
    │   │   └── ...
    │   ├── Treasury.tsx  # Buy/redeem OTT tokens
    │   └── Settings.tsx  # User profile + node config
    └── context/
        └── Web3Context.tsx  # Wallet, contracts, OTT balance
```

## Development

```bash
# Development with hot reload
npm run dev

# Build main process only
npm run build:main

# Run headless server
npm run server

# Build Linux packages (AppImage + .deb)
npm run dist:linux
```

## Deployment

### With Cloudflare Tunnel (recommended for self-hosting)

1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
2. Create tunnel: `cloudflared tunnel create otherthing`
3. Route DNS: `cloudflared tunnel route dns otherthing api.yourdomain.com`
4. Create config.yml pointing to localhost:8080
5. Run: `cloudflared tunnel run otherthing`

### Docker (coming soon)

```bash
docker run -p 8080:8080 -e APPWRITE_PROJECT_ID=xxx otherthing/node
```

## Roadmap

- [x] Local AI agents with Ollama
- [x] Workspace management
- [x] Sandboxed code execution
- [x] IPFS storage
- [x] Semantic memory (ELID)
- [x] Container orchestration (ZLayer)
- [x] UAF architecture framework
- [x] Appwrite cloud backend
- [x] Headless server mode
- [x] Voice/video chat in workspaces
- [x] Embedded code editor (code-server)
- [x] Whiteboard (Excalidraw)
- [x] OTT Treasury (buy/redeem)
- [x] User profiles and display names
- [ ] P2P compute marketplace
- [ ] Multi-node task distribution
- [ ] Production smart contracts (mainnet)
- [ ] Mobile app

## License

MIT

## Links

- **API**: https://api.otherthing.ai
- **GitHub**: https://github.com/server9-dev/otherthing-node
