# OtherThing Node - Production Handoff Document

## Overview

OtherThing Node is an Electron desktop application that allows users to contribute compute resources (CPU, GPU, storage) to the OtherThing distributed compute network. Users can run local AI models via Ollama, share IPFS storage, and earn OTT tokens for their contributions.

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
- **Styling**: Custom CSS (cyberpunk theme)
- **State**: React Context (Web3, Modules, Credentials)
- **Backend Services**:
  - IPFS (Kubo) for distributed storage
  - Ollama for local LLM inference
  - Sandbox for isolated code execution
- **Blockchain**: Ethereum (Sepolia testnet) via ethers.js

## Directory Structure

```
src/
├── main.ts                 # Electron main process entry
├── preload.ts              # IPC bridge (exposes electronAPI)
├── node-service.ts         # Core node functionality
├── api-server.ts           # REST/WebSocket API server
├── hardware.ts             # Hardware detection
├── adapters/               # LLM adapters (OpenAI, Claude, etc.)
├── renderer/
│   ├── App.tsx             # Main React app
│   ├── pages/
│   │   ├── Dashboard.tsx   # Overview & stats
│   │   ├── NodeControl.tsx # IPFS/Ollama/Hardware
│   │   ├── Workspace.tsx   # Workspace management
│   │   ├── Agents.tsx      # AI agent chat
│   │   ├── Marketplace.tsx # Node registry
│   │   └── Settings.tsx    # Configuration
│   ├── components/
│   │   ├── IPFSPanel.tsx   # IPFS controls
│   │   ├── OllamaPanel.tsx # Ollama model management
│   │   ├── NodeBlockchain.tsx # On-chain registration
│   │   └── WalletButton.tsx   # Web3 wallet connect
│   ├── context/
│   │   ├── Web3Context.tsx    # Ethereum provider
│   │   ├── ModuleContext.tsx  # Module state
│   │   └── CredentialContext.tsx # API keys
│   └── styles/
│       ├── cyberpunk.css      # Main theme
│       └── animations.css     # Animations
```

## Smart Contracts (Sepolia)

| Contract | Address | Purpose |
|----------|---------|---------|
| OTT Token | `0x7e3b8A0A1f3b2f3C4D5E6F7A8B9C0D1E2F3A4B5C` | ERC-20 utility token |
| NodeRegistry | `0x1a2B3c4D5e6F7A8B9C0D1E2F3a4B5C6D7E8F9A0B` | Node registration |
| TaskEscrow | `0x2b3C4d5E6f7A8B9c0D1e2F3A4b5C6D7e8F9A0B1C` | Payment escrow |

*Note: Update these addresses for mainnet deployment*

## API Endpoints

### REST API (localhost:8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/workspaces` | GET/POST | Workspace CRUD |
| `/api/v1/workspaces/:id/agents` | GET/POST | Agent management |
| `/api/v1/workspaces/:id/sandbox/files` | GET/POST | File operations |
| `/api/v1/blockchain/nodes` | GET | Registered nodes |

### WebSocket (ws://localhost:8080/ws/agents)

- Real-time agent communication
- Streaming LLM responses

### Hardware API (localhost:3847)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/hardware` | GET | Detect CPU/GPU/RAM/Storage |
| `/status` | GET | Node running status |

## Environment Variables

```env
# Optional - network connection
ORCHESTRATOR_URL=ws://155.117.46.228/ws/node

# Blockchain (for mainnet, change these)
CHAIN_ID=11155111
RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY

# API Keys (stored in electron-store, not env)
# Users configure in Settings page
```

## Build & Deploy

### Development
```bash
npm install
npm run dev        # Starts Vite + Electron concurrently
```

### Production Build (Windows)
```bash
npm run build      # TypeScript + Vite build
npm run dist:win   # electron-builder for Windows
```

Output: `release/OtherThing-Node-Setup.exe`

### Production Build (macOS)
```bash
npm run dist:mac
```

### Production Build (Linux)
```bash
npm run dist:linux
```

## Configuration Files

### electron-builder.yml
```yaml
appId: com.otherthing.node
productName: OtherThing Node
directories:
  output: release
win:
  target: nsis
  icon: assets/icon.ico
mac:
  target: dmg
  icon: assets/icon.icns
```

### vite.config.ts
- Entry: `src/renderer/main.tsx`
- Build output: `dist/renderer`
- Port: 1420 (dev)

## Key Features

### 1. IPFS Storage Node
- Download/install IPFS binary automatically
- Select storage drive
- Configure storage limit (10-500 GB)
- Start/stop IPFS daemon
- Real-time stats (repo size, objects, peer ID)

### 2. Ollama LLM Engine
- Auto-detect or manual install
- Pull models from registry (llama3.2, mistral, codellama, etc.)
- Custom model support
- Select models to share on network
- Start/stop Ollama server

### 3. Workspace Management
- Create/join workspaces
- File browser with sandbox isolation
- Agent chat interface
- IPFS sync for persistence

### 4. Blockchain Integration
- Wallet connect (MetaMask)
- Register node on-chain
- Stake OTT tokens
- View earnings

## Security Considerations

1. **Sandbox Isolation**: All code execution happens in isolated containers
2. **IPC Security**: Context isolation enabled, no nodeIntegration
3. **API CORS**: Configured for localhost only
4. **Private Network Access**: Headers set for browser security

## Monitoring & Logging

- Main process logs to console
- Renderer logs to DevTools (Ctrl+Shift+I)
- Node activity logs in UI (Node Control page)

## Known Issues / TODOs

1. Auto-update mechanism not yet implemented
2. macOS notarization needed for distribution
3. Linux AppImage needs testing

## Support

- GitHub Issues: [repo-url]/issues
- Discord: [discord-link]

## Changelog

### v1.0.0 (Current)
- Initial release
- IPFS integration with drive selection
- Ollama model management
- Workspace/Agent system
- Blockchain node registration
- Cyberpunk UI theme
