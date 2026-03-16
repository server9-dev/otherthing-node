# Compute, Code Server & Containers

## Overview

OtherThing Node provides a layered compute architecture spanning local code editing (code-server), per-workspace sandboxes, cloud GPU rental (Vast.ai), container orchestration (ZLayer), sandbox preview for dev servers, and local hardware detection. All compute resources are managed through the Express API and surfaced in the Electron UI.

---

## Compute Resource Architecture

```mermaid
graph TB
    subgraph "Local Compute"
        HW[Hardware Detection<br/>CPU, Memory, GPU via os module]
        OLLAMA[Ollama<br/>Local LLM inference]
        CS[Code Server<br/>VS Code in browser]
        SB[Sandbox<br/>Per-workspace filesystem]
        SP[Sandbox Preview<br/>Dev server in iframe]
    end

    subgraph "Remote Compute"
        VAST[Cloud GPU - Vast.ai<br/>Rent, tunnel, run models]
    end

    subgraph "Container Orchestration"
        ZL[ZLayer CLI<br/>Deploy, scale, WASM]
    end

    API[Express API :8080] --> HW
    API --> OLLAMA
    API --> CS
    API --> SB
    API --> SP
    API --> VAST
    API --> ZL

    UI[Electron Renderer] --> API
    UI -->|iframe| CS
    UI -->|iframe| SP
```

---

## Code Server

The code-server integration embeds a full VS Code editor inside the workspace Code tab via iframe.

### Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Detection: App start
    Detection --> BinaryFound: code-server in standard paths
    Detection --> NotAvailable: Binary not found

    BinaryFound --> Idle: Binary ready

    Idle --> Spawning: User opens Code tab
    Spawning --> Running: Process started on port

    Running --> Idle: User closes / stop requested
    Running --> Cleanup: App exit signal

    Cleanup --> [*]: Process killed, port freed
```

### Code Server Lifecycle (Detailed)

```mermaid
sequenceDiagram
    participant User as User
    participant UI as Electron Renderer
    participant API as Express API
    participant CS as code-server Process

    Note over API: Detection Phase
    API->>API: Scan standard install paths for code-server binary

    Note over User: User opens Code tab
    User->>UI: Navigate to Code tab
    UI->>API: POST /api/compute/code-server/start { workspaceId }
    API->>API: Assign unique port (base 13370 + offset)
    API->>CS: Spawn code-server process
    Note over CS: --auth none<br/>--host 127.0.0.1<br/>--port {assigned}<br/>workspace folder as root
    CS-->>API: Process started, port bound
    API-->>UI: { url: "http://localhost:{port}", status: "running" }
    UI->>UI: Embed iframe pointing to code-server URL

    Note over User: Working in editor...

    Note over User: App exit
    UI->>API: POST /api/compute/code-server/stop
    API->>CS: SIGTERM
    CS-->>API: Process exited
    API->>API: Free port allocation
```

**Key details:**
- Binary detected from standard install paths (e.g., `/usr/bin/code-server`, `~/.local/bin/code-server`)
- Each workspace gets a unique port starting from base `13370`
- Auth is disabled (`--auth none`) since access is localhost-only
- Workspace folder is set as the editor root directory
- On app exit, all code-server processes are cleaned up via SIGTERM

---

## Sandbox

Per-workspace isolated filesystem for agent code execution.

### Operations

| Operation | Description |
|-----------|-------------|
| Create | Initialize sandbox directory for a workspace |
| List files | Enumerate files in the sandbox |
| Read file | Read file content from sandbox |
| Write file | Write or create a file in sandbox |
| Delete file | Remove a file from sandbox |
| Delete sandbox | Remove entire sandbox directory |

Sandboxes provide isolation so that agent-executed code operates within a contained filesystem boundary per workspace, without affecting the host or other workspaces.

---

## Cloud GPU (Vast.ai Integration)

Rent remote GPU instances for model inference, fine-tuning, or heavy compute tasks.

### GPU Rental Flow

```mermaid
sequenceDiagram
    participant User as User
    participant API as Express API
    participant Vast as Vast.ai API

    Note over User: Configuration
    User->>API: POST /api/compute/gpu/configure { apiKey }
    API->>API: Store Vast.ai API key

    Note over User: Search & Rent
    User->>API: GET /api/compute/gpu/offers?minVRAM=24&maxPrice=0.50&gpuType=RTX4090
    API->>Vast: Query available offers
    Vast-->>API: Filtered offers list
    API-->>User: Available GPU instances

    User->>API: POST /api/compute/gpu/rent { offerId, config }
    API->>Vast: Create instance
    Vast-->>API: Instance created
    API-->>User: Instance details

    Note over User: Connect & Use
    User->>API: POST /api/compute/gpu/tunnel { instanceId, ports }
    API->>API: Establish SSH tunnel with port forwarding
    API-->>User: Tunnel active

    User->>API: POST /api/compute/gpu/pull { instanceId, model }
    API->>Vast: Pull model to instance
    Vast-->>API: Model ready
    API-->>User: Model available

    User->>API: GET /api/compute/gpu/models { instanceId }
    API->>Vast: List models on instance
    Vast-->>API: Model list
    API-->>User: Models on instance

    Note over User: Terminate
    User->>API: DELETE /api/compute/gpu/instances/:id
    API->>Vast: Destroy instance
    Vast-->>API: Instance terminated
    API->>API: Close SSH tunnel
    API-->>User: Instance removed
```

**Offer filters:**
- Minimum VRAM (GB)
- Maximum price ($/hr)
- GPU type (RTX 3090, RTX 4090, A100, etc.)

---

## ZLayer Container Orchestration

ZLayer provides container deployment, scaling, and WASM execution capabilities.

### ZLayer Deployment Flow

```mermaid
sequenceDiagram
    participant User as User
    participant API as Express API
    participant ZL as ZLayer CLI

    Note over API: Setup
    API->>API: Check ZLayer CLI status
    alt CLI not installed
        User->>API: POST /api/compute/zlayer/install
        API->>API: Download ZLayer CLI binary
        API-->>User: CLI installed
    end

    Note over User: Build & Deploy
    User->>API: POST /api/compute/zlayer/build { dockerfile, tag }
    API->>ZL: Build container image
    ZL-->>API: Image built
    API-->>User: Image ready

    User->>API: POST /api/compute/zlayer/deploy { image, config }
    API->>ZL: Deploy service
    ZL-->>API: Service running
    API-->>User: Service deployed

    Note over User: Manage
    User->>API: POST /api/compute/zlayer/scale { serviceId, replicas }
    API->>ZL: Scale service
    ZL-->>API: Scaled
    API-->>User: New replica count

    User->>API: GET /api/compute/zlayer/logs { serviceId }
    API->>ZL: Fetch logs
    ZL-->>API: Log output
    API-->>User: Service logs

    Note over User: Cleanup
    User->>API: POST /api/compute/zlayer/stop { serviceId }
    API->>ZL: Stop service
    ZL-->>API: Stopped

    User->>API: DELETE /api/compute/zlayer/services/:id
    API->>ZL: Remove service
    ZL-->>API: Removed
    API-->>User: Service removed
```

### ZLayer Capabilities

| Feature | Description |
|---------|-------------|
| Service deploy | Deploy container images as services |
| Service stop/remove | Lifecycle management |
| Service scale | Adjust replica count |
| Service logs | Stream/fetch logs |
| Image build | Build container images from Dockerfiles |
| WASM execution | Run WebAssembly modules |
| WASM support detection | Check if host supports WASM runtime |
| Workspace deploy | Auto-containerize a workspace and deploy |

### Workspace Auto-Deploy

The `workspace-deploy` endpoint packages an entire workspace into a container image and deploys it via ZLayer in a single operation. This automates the build-deploy cycle for rapid iteration.

---

## Sandbox Preview

Run a workspace's dev server and embed it in the UI for live preview.

### Sandbox Preview Flow

```mermaid
sequenceDiagram
    participant User as User
    participant UI as Electron Renderer
    participant API as Express API
    participant Proc as Dev Server Process

    User->>UI: Click "Start Preview"
    UI->>API: POST /api/sandbox-preview/start { workspaceId, command? }
    API->>API: Determine command (default: pnpm dev)
    API->>Proc: Spawn process in workspace directory

    loop Monitor stdout
        Proc->>API: stdout output
        API->>API: Detect port from output (e.g., "localhost:3000")
    end

    API-->>UI: { status: "running", port: 3000, url: "http://localhost:3000" }
    UI->>UI: Embed iframe to localhost:{port}

    Note over User: Live preview active...

    User->>UI: Click "Stop Preview"
    UI->>API: POST /api/sandbox-preview/stop { workspaceId }
    API->>Proc: SIGTERM
    Proc-->>API: Process exited
    API->>API: Port freed
    API-->>UI: { status: "stopped" }
    UI->>UI: Remove iframe
```

**Key details:**
- Default command is `pnpm dev`, can be overridden per workspace
- Port is auto-detected by parsing stdout for common patterns (e.g., `localhost:XXXX`, `port XXXX`)
- Preview is embedded as an iframe in the workspace UI
- Process is killed and port freed on stop or app exit

---

## Local Compute Summary

The `/api/compute/summary` endpoint aggregates local compute resource information.

| Resource | Detection Method |
|----------|-----------------|
| CPU | `os.cpus()` -- model, cores, speed |
| Memory | `os.totalmem()` / `os.freemem()` |
| GPU count | System-specific detection |
| Ollama models | Query Ollama API for installed models |

The hardware detection endpoint (`/api/compute/hardware`) provides detailed system information for compute capability reporting, used by the Web3 node verification system to advertise what a node can offer to the network.
