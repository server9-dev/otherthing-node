# OtherThing Node

Desktop application for the OtherThing distributed compute network. Run local AI models, share IPFS storage, and earn OTT tokens for your contributions.

## Features

### Compute & Storage
- **IPFS Storage Node** - Share disk space on the distributed network with configurable limits (10-500 GB)
- **Ollama LLM Engine** - Run local AI models (Llama, Mistral, CodeLlama, etc.) and share inference capacity
- **Hardware Detection** - Automatically detects CPU, RAM, Storage, and GPUs
- **Resource Limits** - Fine-grained control over shared resources

### Workspaces & Agents
- **Workspace Management** - Create and join collaborative workspaces
- **AI Agent Chat** - Interactive agent interface with streaming responses
- **Sandboxed Execution** - Isolated code execution environment
- **File Browser** - Browse and manage workspace files with IPFS sync

### Blockchain Integration
- **Wallet Connect** - Connect via WalletConnect QR or private key
- **Node Registration** - Register your node on-chain with OTT stake
- **Token Rewards** - Earn OTT tokens for compute contributions
- **Network Selection** - Sepolia testnet (mainnet coming soon)

## Screenshots

The app features a cyberpunk-themed UI with glassmorphism effects:
- Dashboard with real-time stats
- Node Control panel for IPFS/Ollama management
- Workspace file browser and agent chat
- Marketplace for network nodes

## Installation

### Download
- **Windows**: [OtherThing-Node-Setup.exe](https://github.com/server9-dev/otherthing-node/releases/latest)
- **macOS**: [OtherThing-Node.dmg](https://github.com/server9-dev/otherthing-node/releases/latest)
- **Linux**: [OtherThing-Node.AppImage](https://github.com/server9-dev/otherthing-node/releases/latest)

### From Source
```bash
# Clone the repository
git clone https://github.com/server9-dev/otherthing-node.git
cd otherthing-node

# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build
npm run dist:win   # Windows
npm run dist:mac   # macOS
npm run dist:linux # Linux
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ NodeService │  │  ApiServer   │  │  HardwareDetector │  │
│  │  - IPFS     │  │  :8080       │  │                   │  │
│  │  - Ollama   │  │  REST + WS   │  │                   │  │
│  │  - Sandbox  │  └──────────────┘  └───────────────────┘  │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
                              ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                   Electron Renderer (React)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │Dashboard │  │NodeCtrl  │  │Workspace │  │Marketplace │  │
│  │          │  │-IPFS     │  │-Agents   │  │-Blockchain │  │
│  │          │  │-Ollama   │  │-Files    │  │            │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Framework**: Electron 36.x
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Custom CSS with cyberpunk theme
- **State**: React Context (Web3, Modules, Credentials)
- **Blockchain**: ethers.js v6 + WalletConnect
- **Storage**: IPFS (Kubo)
- **AI**: Ollama for local LLM inference

## API Endpoints

### REST API (localhost:8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/workspaces` | GET/POST | Workspace CRUD |
| `/api/v1/workspaces/:id/agents` | GET/POST | Agent management |
| `/api/v1/workspaces/:id/sandbox/files` | GET/POST | File operations |

### WebSocket (ws://localhost:8080/ws/agents)
- Real-time agent communication
- Streaming LLM responses

### Hardware API (localhost:3847)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/hardware` | GET | Detect CPU/GPU/RAM/Storage |
| `/status` | GET | Node running status |

## Smart Contracts (Sepolia Testnet)

| Contract | Address |
|----------|---------|
| OTT Token | `0x81f3b3391380014e05f85323E97A764607e851Fc` |
| NodeRegistry | `0x610D93a28703Dd7DfC23E3C16A498210997c9B34` |
| TaskEscrow | `0x5643B12c1f7332B7443Ff0F3F1dff422C9460832` |

## Configuration

API keys for external LLM providers can be configured in Settings:
- OpenAI
- Anthropic (Claude)
- Google (Gemini)

Keys are stored securely in electron-store and never transmitted.

## Development

```bash
# Start dev server with hot reload
npm run dev

# TypeScript check
npx tsc --noEmit

# Build main process
npm run build:main

# Build renderer
npm run build:renderer
```

## Project Structure

```
src/
├── main.ts                 # Electron main process
├── preload.ts              # IPC bridge
├── node-service.ts         # Core node functionality
├── api-server.ts           # REST/WebSocket server
├── hardware.ts             # Hardware detection
├── adapters/               # LLM adapters
├── renderer/
│   ├── App.tsx             # Main React app
│   ├── pages/              # Page components
│   ├── components/         # UI components
│   ├── context/            # React contexts
│   └── styles/             # CSS themes
└── services/               # Backend services
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT

## Links

- [OtherThing Cloud](https://otherthing.io)
- [Documentation](https://docs.otherthing.io)
- [Discord](https://discord.gg/otherthing)
