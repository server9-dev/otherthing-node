# Storage & IPFS Data Flows

## Overview

OtherThing Node uses a multi-layer storage architecture combining decentralized storage (IPFS), ephemeral in-memory stores, local filesystem persistence, an IPFS export service for workspace artifacts, and optional Appwrite cloud storage. Each layer serves a distinct purpose in the platform's local-first design.

---

## Storage Architecture

```mermaid
graph TB
    subgraph "Layer 1: IPFS (Kubo v0.24.0)"
        IPFS_DAEMON[IPFS Daemon]
        IPFS_REPO["Repo: ${storagePath}/otherthing-storage/ipfs"]
        SWARM_KEY[Swarm Key - Workspace Isolation]
        IPFS_DAEMON --> IPFS_REPO
        IPFS_DAEMON --> SWARM_KEY
    end

    subgraph "Layer 2: In-Memory Stores"
        TASKS["Tasks Map<workspaceId, tasks[]>"]
        CHAT["Chat Map<workspaceId, messages[]> (last 500)"]
        AGENTS["Agent Executions Map<executionId, execution>"]
        TRANSCRIPTION[Transcription Sessions]
        DIGEST[Digest Results]
        HEALTH[Health Reports]
    end

    subgraph "Layer 3: Local Filesystem"
        WS_CONFIG["~/.otherthing-node/workspaces.json"]
        NODE_CONFIG[Node Config in userData]
        CLONED_REPOS[Cloned Repos]
        SANDBOX_FILES[Sandbox Files per Workspace]
    end

    subgraph "Layer 4: IPFS Export Service"
        EXPORT_SVC[Export Service]
        ARTIFACT_INDEX[In-Memory Artifact Index]
        EXPORT_SVC --> IPFS_DAEMON
        EXPORT_SVC --> ARTIFACT_INDEX
    end

    subgraph "Layer 5: Appwrite Cloud (Optional)"
        APPWRITE[User Profiles]
    end

    CLIENT[Desktop Electron App] --> IPFS_DAEMON
    CLIENT --> TASKS
    CLIENT --> CHAT
    CLIENT --> WS_CONFIG
    CLIENT --> EXPORT_SVC
    CLIENT --> APPWRITE
```

---

## Layer 1: IPFS (Kubo v0.24.0)

Primary decentralized storage. The Kubo binary is auto-downloaded on first run. Operates in **private network mode** with public bootstrap nodes, DHT, and mDNS all disabled. A swarm key provides workspace-level isolation.

**Repo location:** `${storagePath}/otherthing-storage/ipfs`

### IPFS API

| Method | Signature | Description |
|--------|-----------|-------------|
| `addContent` | `addContent(content, filename) -> CID` | Add raw content with a filename, returns CID |
| `add` | `add(filePath) -> CID` | Add a file from local filesystem, returns CID |
| `get` | `get(cid, outputPath)` | Retrieve content by CID to a local path |
| `pin` | `pin(cid)` | Pin content to prevent garbage collection |
| `unpin` | `unpin(cid)` | Unpin content, allowing garbage collection |
| `connectPeer` | `connectPeer(multiaddr)` | Connect to a peer by multiaddress |

### IPFS Initialization Flow

```mermaid
flowchart TD
    START([App Start]) --> CHECK{Kubo binary exists?}
    CHECK -->|No| DOWNLOAD[Download Kubo v0.24.0 binary]
    DOWNLOAD --> VERIFY[Verify binary integrity]
    VERIFY --> INIT
    CHECK -->|Yes| INIT{IPFS repo initialized?}
    INIT -->|No| REPO_INIT["ipfs init (create repo)"]
    REPO_INIT --> CONFIGURE
    INIT -->|Yes| CONFIGURE[Apply private network config]
    CONFIGURE --> DISABLE_BOOTSTRAP[Disable public bootstrap nodes]
    DISABLE_BOOTSTRAP --> DISABLE_DHT[Disable DHT discovery]
    DISABLE_DHT --> DISABLE_MDNS[Disable mDNS discovery]
    DISABLE_MDNS --> SWARM[Install swarm key for workspace isolation]
    SWARM --> START_DAEMON[Start IPFS daemon]
    START_DAEMON --> READY([IPFS Ready])
```

---

## Layer 2: In-Memory Stores

Ephemeral data that lives only for the duration of the app session. These stores provide fast access for active workspace data.

| Store | Key | Value | Notes |
|-------|-----|-------|-------|
| Tasks | `workspaceId` | `tasks[]` | All tasks for a workspace |
| Chat | `workspaceId` | `messages[]` | Rolling window, last 500 messages |
| Agent Executions | `executionId` | `execution` | Active and completed agent runs |
| Transcription Sessions | `sessionId` | `session` | Voice transcription in progress |
| Digest Results | `digestId` | `digest` | Generated workspace digests |
| Health Reports | `reportId` | `report` | Workspace health analysis results |

---

## Layer 3: Local Filesystem

Persistent configuration and workspace data stored on the local machine.

| Path | Contents | Persistence |
|------|----------|-------------|
| `~/.otherthing-node/workspaces.json` | Workspace membership and configuration | Permanent |
| `userData` (Electron) | Node identity, keys, settings | Permanent |
| Cloned repos directory | Git repositories pulled for workspaces | Permanent until deleted |
| Sandbox files | Per-workspace isolated file trees | Permanent until workspace deleted |

---

## Layer 4: IPFS Export Service

Exports workspace artifacts to IPFS for decentralized persistence and sharing. Maintains an in-memory index of artifacts per workspace.

### WorkspaceArtifact Schema

```
WorkspaceArtifact {
    cid: string           // IPFS content identifier
    type: ArtifactType    // One of the supported artifact types
    workspaceId: string   // Owning workspace
    timestamp: number     // Export timestamp
    metadata: object      // Type-specific metadata
}
```

### Supported Artifact Types

| Type | Description |
|------|-------------|
| `chat` | Workspace chat history |
| `whiteboard` | Whiteboard canvas state |
| `transcription` | Voice transcription output |
| `digest` | AI-generated workspace digest |
| `handoff` | Project handoff document |
| `health-report` | Workspace health analysis |
| `dispute-analysis` | Dispute resolution analysis |

### Querying Artifacts

`getArtifactsSince(workspaceId, since, type?)` -- Retrieve artifacts for a workspace since a given timestamp, optionally filtered by type.

### Artifact Export Pipeline

```mermaid
sequenceDiagram
    participant Service as Service Layer
    participant Export as IPFS Export Service
    participant IPFS as IPFS Daemon
    participant Index as Artifact Index

    Service->>Export: exportArtifact(workspaceId, type, data)
    Export->>Export: Serialize data to JSON
    Export->>IPFS: addContent(serialized, filename)
    IPFS-->>Export: CID returned
    Export->>Index: Store WorkspaceArtifact record
    Note over Index: { cid, type, workspaceId, timestamp, metadata }
    Export-->>Service: CID returned to caller
```

---

## Layer 5: Appwrite Cloud (Optional)

Optional cloud storage backend for user profile data. Used when users opt into cloud-backed profiles for cross-device access.

---

## Repo Sync Flow

Repositories are synced between nodes via IPFS. A local git repo is archived, added to IPFS, and the CID is shared. Remote nodes retrieve and extract.

```mermaid
sequenceDiagram
    participant Local as Local Node
    participant Git as Local Git Repo
    participant IPFS as IPFS Network
    participant Remote as Remote Node

    Note over Local: Push / Sync
    Local->>Git: Access repo directory
    Git->>Local: Repo contents
    Local->>Local: tar archive repo
    Local->>IPFS: add(tarball) -> CID
    IPFS-->>Local: CID stored in workspace state

    Note over Remote: Pull
    Remote->>IPFS: get(cid, outputPath)
    IPFS-->>Remote: Tarball retrieved
    Remote->>Remote: Extract tarball to workspace repo dir
    Remote->>Git: Repo available locally
```

---

## Data Persistence Model

```mermaid
graph LR
    subgraph "Persistent (Survives Restart)"
        FS["Local Filesystem\n- workspaces.json\n- Node config\n- Cloned repos\n- Sandbox files"]
        IPFS_STORE["IPFS Repo\n- Pinned content\n- Exported artifacts"]
        CLOUD["Appwrite Cloud\n- User profiles"]
    end

    subgraph "Ephemeral (Lost on Restart)"
        MEM["In-Memory Stores\n- Tasks\n- Chat (last 500)\n- Agent executions\n- Transcription sessions\n- Digest results\n- Health reports"]
        IDX["Artifact Index\n- In-memory CID index\n(CIDs survive in IPFS,\nindex rebuilt on restart)"]
    end

    style FS fill:#2d5a2d,color:#fff
    style IPFS_STORE fill:#2d5a2d,color:#fff
    style CLOUD fill:#2d5a2d,color:#fff
    style MEM fill:#8b4513,color:#fff
    style IDX fill:#8b4513,color:#fff
```

**Key distinction:** IPFS content itself persists (pinned data survives daemon restarts), but the in-memory artifact index is ephemeral. The CIDs remain valid and content is retrievable, but the index mapping workspace IDs to artifact CIDs must be rebuilt.
