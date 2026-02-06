# OtherThing Node

> **A decentralized workspace platform for P2P compute, AI agents, and collaborative development with blockchain-backed payments and IP protection.**

Desktop + headless application for the OtherThing network. Run local AI models, share compute resources, collaborate in workspaces, and get paid via smart contracts.

**Live API: https://api.otherthing.ai**

## What It Does

OtherThing lets teams collaborate on projects with:
- **Shared AI Agents** - Run tasks using local or distributed LLMs
- **P2P Compute** - Share CPU/GPU resources across the network
- **Smart Contracts** - Escrow payments, milestone releases, IP licensing
- **Enterprise Architecture** - UAF framework for systems modeling
- **Sandboxed Execution** - Isolated code execution with container/WASM support

## Current Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Backend** | Appwrite Cloud | Users, workspaces, UAF elements, contracts |
| **API** | Express + WebSocket | REST API + real-time agent streaming |
| **AI** | Ollama | Local LLM inference (Llama, Mistral, etc.) |
| **Memory** | ELID | Semantic search without vector DB |
| **Containers** | ZLayer | Daemonless orchestration + WASM |
| **Storage** | IPFS | Distributed file storage |
| **Blockchain** | Ethereum (Sepolia) | OTT token, escrow, node registry |
| **CDN/Tunnel** | Cloudflare | Public API at api.otherthing.ai |

## Quick Start

### Desktop App (Electron)
```bash
git clone https://github.com/server9-dev/otherthing-node.git
cd otherthing-node
npm install
npm start
```

### Headless Server (WSL/Docker/CLI)
```bash
npm install
cp .env.example .env  # Configure Appwrite credentials
npm run server
```

The API will be available at `http://localhost:8080`.

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
| `ws://localhost:8080/ws/agents` | WS | Real-time agent streaming |

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

### Sandbox (Code Execution)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/workspaces/:id/sandbox/files` | GET/POST | File operations |
| `/api/v1/workspaces/:id/sandbox/execute` | POST | Run shell command |

## Agent Tools

Agents have access to these tools:

**Filesystem**: `read_file`, `write_file`, `list_dir`, `search_files`, `shell`

**Memory**: `memory_store`, `memory_search`, `memory_recent`, `memory_stats`

**UAF**: `uaf_create_element`, `uaf_query_elements`, `uaf_link_elements`, `uaf_generate_view`, `uaf_stats`, `uaf_export`

## UAF Framework

Implements the OMG Unified Architecture Framework (ISO/IEC 19540) for enterprise/systems architecture:

**11 Viewpoints:**
- Strategic (WHY) - Capabilities, goals, vision
- Operational (WHAT) - Activities, performers, exchanges
- Services - Service definitions and interfaces
- Personnel (WHO) - Roles, organizations, skills
- Resources (HOW) - Systems, software, hardware
- Security - Controls, threats, risks
- Projects (WHEN) - Timelines, milestones
- Standards - Protocols, guidance
- And more...

**14 Model Kinds:** Taxonomy, Structure, Connectivity, Processes, States, Scenarios, Information, Parameters, Constraints, Traceability, Roadmap, Dictionary, Requirements

This creates a 71-cell grid for comprehensive architecture modeling.

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
├── api-server.ts        # REST/WebSocket API
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
│   ├── uaf-types.ts          # UAF TypeScript types
│   ├── uaf-views.ts          # Mermaid diagram generation
│   ├── semantic-memory.ts    # ELID-based memory
│   ├── elid-service.ts       # Embedding locality IDs
│   ├── zlayer-service.ts     # Container orchestration
│   ├── web3-service.ts       # Blockchain integration
│   └── workspace-manager.ts  # Workspace management
└── renderer/            # React frontend
```

## Development

```bash
# Development with hot reload
npm run dev

# Build main process only
npm run build:main

# Run headless server
npm run server

# TypeScript check
npx tsc --noEmit
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
- [ ] P2P compute marketplace
- [ ] Multi-node task distribution
- [ ] Production smart contracts
- [ ] Mobile app

## License

MIT

## Links

- **API**: https://api.otherthing.ai
- **GitHub**: https://github.com/server9-dev/otherthing-node
