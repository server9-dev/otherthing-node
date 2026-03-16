# Workspace & Collaboration

## Overview

Workspaces are the central organizational unit in OtherThing Node. They are created on-chain (Ethereum Sepolia) via a smart contract and tracked locally in `~/.otherthing-node/workspaces.json` by the `WorkspaceManager` service. Each workspace provides a full collaboration environment: tasks, chat, file management, repositories, code editing, whiteboard, voice/video calls, AI assistance, digest summaries, and health reports.

---

## 1. Workspace Creation

Workspaces are created through a smart contract call on Ethereum Sepolia, then registered locally.

### Smart Contract Parameters

| Parameter     | Type      | Description                                        |
|---------------|-----------|----------------------------------------------------|
| `name`        | `string`  | Workspace display name                             |
| `isPublic`    | `bool`    | Whether the workspace is publicly discoverable      |
| `stakeAmount` | `uint256` | Required stake in OTT tokens to create the workspace|

### Creation Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Renderer (React)
    participant API as Express API (localhost:8080)
    participant WM as WorkspaceManager Service
    participant SC as Smart Contract (Sepolia)
    participant FS as Local Filesystem

    User->>UI: Fill workspace form (name, public, stake)
    UI->>API: POST /api/v1/workspaces<br/>{ name, isPublic, stakeAmount }
    API->>SC: Call createWorkspace(name, isPublic, stakeAmount)
    SC->>SC: Validate stake, register workspace on-chain
    SC-->>API: Transaction receipt + workspaceId
    API->>WM: registerWorkspace(workspaceId, metadata)
    WM->>FS: Write to ~/.otherthing-node/workspaces.json
    WM-->>API: { workspace: { id, name, owner, members } }
    API-->>UI: 201 Created — workspace object
    UI->>User: Navigate to new workspace
```

### Local Storage Format (`~/.otherthing-node/workspaces.json`)

```json
{
  "workspaces": [
    {
      "id": "0x...",
      "name": "My Project",
      "owner": "0xOwnerAddress",
      "isPublic": true,
      "stakeAmount": "100",
      "members": ["0xOwnerAddress", "0xMember1"],
      "createdAt": "2026-03-10T12:00:00Z"
    }
  ]
}
```

---

## 2. Member Management

Members are loaded from the blockchain. New members join via invite codes.

### Flow

```mermaid
sequenceDiagram
    participant Owner
    participant UI as Renderer
    participant API as Express API
    participant SC as Smart Contract (Sepolia)
    participant WM as WorkspaceManager

    Note over Owner,WM: Generating an invite
    Owner->>UI: Click "Invite Member"
    UI->>API: POST /api/v1/workspaces/:id/invite
    API->>API: Generate unique invite code, store with workspaceId + expiry
    API-->>UI: { inviteCode: "abc123" }
    Owner->>Owner: Share invite code out-of-band

    Note over Owner,WM: Joining via invite
    participant Joiner as New Member
    Joiner->>UI: Enter invite code
    UI->>API: POST /api/v1/workspaces/join<br/>{ inviteCode: "abc123" }
    API->>API: Validate invite code, check expiry
    API->>SC: Call addMember(workspaceId, memberAddress)
    SC-->>API: Transaction receipt
    API->>WM: updateMembers(workspaceId)
    WM->>WM: Refresh members from chain, update workspaces.json
    API-->>UI: { success: true, workspace: { ... } }
```

### Member Loading

On workspace open, the API reads the member list from the smart contract and caches it locally:

```mermaid
flowchart TD
    A[Open Workspace] --> B[API: GET /api/v1/workspaces/:id]
    B --> C[WorkspaceManager.getWorkspace]
    C --> D{Cache fresh?}
    D -- Yes --> E[Return cached members]
    D -- No --> F[Query smart contract for member list]
    F --> G[Update workspaces.json]
    G --> E
```

---

## 3. Workspace Tabs Architecture

Each workspace renders a tabbed interface. All tabs share the workspace context (ID, members, permissions).

```mermaid
flowchart LR
    subgraph WorkspacePage
        direction TB
        WH[Workspace Header — name, balance, members]
        TB[Tab Bar]
        TC[Tab Content Area]
    end

    TB --> T1[Overview]
    TB --> T2[Chat]
    TB --> T3[Tasks]
    TB --> T4[Code]
    TB --> T5[Files]
    TB --> T6[Whiteboard]
    TB --> T7[Digest]
    TB --> T8[Health]
    TB --> T9[Preview]
    TB --> T10[AI Studio]
    TB --> T11[Members]
```

| Tab        | Key Component               | Backend Route Prefix              | Description                                    |
|------------|-----------------------------|-----------------------------------|------------------------------------------------|
| Overview   | `OverviewTab`               | `/api/v1/workspaces/:id`          | Workspace summary, recent activity              |
| Chat       | `ChatTab`                   | `/api/v1/workspaces/:id/chat`     | Real-time team messaging                        |
| Tasks      | `TasksTab`                  | `/api/v1/tasks`                   | Task board with escrow, assignment, status       |
| Code       | `CodeTab`                   | `/api/v1/repos`, `/api/v1/compute`| code-server editor, repo management             |
| Files      | `FilesTab`                  | `/api/v1/files`                   | Local and IPFS file management                   |
| Whiteboard | `WhiteboardTab`             | --                                | Embedded whiteboard iframe                       |
| Digest     | `DigestTab`                 | `/api/v1/workspaces/:id/digest`   | AI-generated workspace activity summaries        |
| Health     | `HealthTab`                 | `/api/v1/workspaces/:id/health`   | Project health reports and metrics               |
| Preview    | `PreviewTab`                | --                                | Live preview of workspace outputs                |
| AI Studio  | `AIStudioTab`               | `/api/v1/ai`                      | AI chat, code analysis, project planning         |
| Members    | `MembersTab`                | `/api/v1/workspaces/:id/members`  | Member list, roles, invite management            |

---

## 4. Team Chat

Chat messages are stored in an in-memory `Map<workspaceId, messages[]>` on the Express server. The last 500 messages are retained per workspace. Every 100 messages, an automatic export to IPFS is triggered.

### Message Lifecycle

```mermaid
sequenceDiagram
    participant Sender as Sender (Renderer)
    participant API as Express API
    participant Store as In-Memory Store<br/>Map<workspaceId, msgs[]>
    participant IPFS as IPFS Node
    participant Receivers as Other Clients (Polling)

    Sender->>API: POST /api/v1/workspaces/:id/chat<br/>{ content: "Hello team", sender: "0xABC" }
    API->>Store: Push message to messages[workspaceId]
    Store->>Store: Check message count

    alt count >= 500
        Store->>Store: Trim oldest messages (keep 500)
    end

    alt count % 100 === 0
        Store->>IPFS: Auto-export batch to IPFS
        IPFS-->>Store: CID for archived batch
        Store->>Store: Store export CID in metadata
    end

    API-->>Sender: 201 Created — { message }

    Note over Receivers,API: Polling (every 3 seconds)
    Receivers->>API: GET /api/v1/workspaces/:id/chat?after=<timestamp>
    API->>Store: Filter messages after timestamp
    API-->>Receivers: { messages: [...new messages] }
```

### Chat Data Flow Detail

```mermaid
flowchart TD
    A[Client sends message] --> B[POST /api/v1/workspaces/:id/chat]
    B --> C[Append to in-memory Map]
    C --> D{messages.length > 500?}
    D -- Yes --> E[Trim to 500 — discard oldest]
    D -- No --> F{messages.length % 100 === 0?}
    E --> F
    F -- Yes --> G[Export batch to IPFS]
    G --> H[Store CID reference]
    H --> I[Return 201 to sender]
    F -- No --> I
    I --> J[Other clients poll GET ...?after=timestamp]
    J --> K[Return new messages since timestamp]
```

### Endpoints

| Method | Path                                    | Description                              |
|--------|-----------------------------------------|------------------------------------------|
| POST   | `/api/v1/workspaces/:id/chat`           | Send a message                           |
| GET    | `/api/v1/workspaces/:id/chat`           | Fetch messages (supports `?after=` param)|
| GET    | `/api/v1/workspaces/:id/chat/exports`   | List IPFS export CIDs for chat history   |

---

## 5. Repository Management

Repositories are cloned via URL and stored on the local filesystem. They can be synced to and from IPFS for decentralized sharing. AI-powered repo analysis is available.

### Repository Sync Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Renderer
    participant API as Express API
    participant FS as Local Filesystem
    participant IPFS as IPFS Node
    participant AI as AI Analysis Service

    Note over User,AI: Clone from URL
    User->>UI: Enter repo URL
    UI->>API: POST /api/v1/repos/clone<br/>{ url: "https://github.com/org/repo.git" }
    API->>FS: git clone into workspace repo directory
    FS-->>API: Clone complete
    API-->>UI: { repo: { name, path, status } }

    Note over User,AI: Push to IPFS
    User->>UI: Click "Push to IPFS"
    UI->>API: POST /api/v1/repos/:id/ipfs/push
    API->>FS: Read repo contents
    API->>IPFS: Add repo tree to IPFS
    IPFS-->>API: Root CID
    API-->>UI: { cid: "Qm..." }

    Note over User,AI: Pull from IPFS
    User->>UI: Enter CID, click "Pull from IPFS"
    UI->>API: POST /api/v1/repos/ipfs/pull<br/>{ cid: "Qm..." }
    API->>IPFS: Fetch tree by CID
    IPFS-->>API: Repo contents
    API->>FS: Write to local repo directory
    API-->>UI: { repo: { name, path, status } }

    Note over User,AI: AI Analysis
    User->>UI: Click "Analyze Repo"
    UI->>API: POST /api/v1/repos/:id/analyze
    API->>AI: Send repo structure + key files
    AI-->>API: Analysis results (summary, suggestions, architecture)
    API-->>UI: { analysis: { ... } }
```

### Full Lifecycle Diagram

```mermaid
flowchart TD
    A[Repo URL] -->|git clone| B[Local Filesystem]
    B -->|Push to IPFS| C[IPFS Network]
    C -->|Share CID| D[Other Team Members]
    D -->|Pull from IPFS| E[Their Local Filesystem]
    B -->|AI Analysis| F[Analysis Results]
    B -->|Open in code-server| G[Browser-Based Editor]

    subgraph Storage Locations
        B
        C
    end
```

### Endpoints

| Method | Path                            | Description                        |
|--------|---------------------------------|------------------------------------|
| GET    | `/api/v1/repos`                 | List all repos in workspace        |
| POST   | `/api/v1/repos/clone`           | Clone a repo by URL                |
| DELETE | `/api/v1/repos/:id`             | Remove a local repo                |
| POST   | `/api/v1/repos/:id/ipfs/push`   | Push repo contents to IPFS         |
| POST   | `/api/v1/repos/ipfs/pull`       | Pull repo contents from IPFS by CID|
| POST   | `/api/v1/repos/:id/analyze`     | Run AI analysis on a repo          |
| GET    | `/api/v1/repos/:id/files`       | List files in a repo               |

### Key Files

| File                          | Role                                              |
|-------------------------------|---------------------------------------------------|
| `src/routes/repos.ts`         | Express routes for repo CRUD and IPFS sync         |
| `src/routes/compute.ts`       | Express routes for code-server and compute tasks   |
| `src/renderer/pages/workspace/CodeTab.tsx` | React UI for code editor and repo management |

---

## 6. Voice / Video Calls

Real-time voice and video calls use WebRTC with signaling handled over a WebSocket connection at `/ws/agents`. Participant state is tracked server-side in a `callParticipants` Map. Live transcription is available during calls.

### Signaling Flow

```mermaid
sequenceDiagram
    participant A as Caller (Renderer)
    participant WS as WebSocket Server (/ws/agents)
    participant Map as callParticipants Map
    participant B as Callee (Renderer)

    Note over A,B: Joining a call
    A->>WS: { type: "call-join", workspaceId, userId }
    WS->>Map: Add A to callParticipants[workspaceId]
    WS->>B: { type: "call-join", userId: A }

    Note over A,B: WebRTC negotiation
    A->>WS: { type: "sdp-offer", target: B, sdp: offer }
    WS->>B: { type: "sdp-offer", from: A, sdp: offer }
    B->>WS: { type: "sdp-answer", target: A, sdp: answer }
    WS->>A: { type: "sdp-answer", from: B, sdp: answer }

    Note over A,B: ICE candidate exchange
    A->>WS: { type: "ice-candidate", target: B, candidate }
    WS->>B: { type: "ice-candidate", from: A, candidate }
    B->>WS: { type: "ice-candidate", target: A, candidate }
    WS->>A: { type: "ice-candidate", from: B, candidate }

    Note over A,B: Media flows peer-to-peer
    A<-->B: Direct WebRTC media stream (audio/video)

    Note over A,B: Leaving a call
    A->>WS: { type: "call-leave", workspaceId, userId }
    WS->>Map: Remove A from callParticipants[workspaceId]
    WS->>B: { type: "call-leave", userId: A }
```

### Signaling Message Types

| Message Type      | Direction       | Payload                                         |
|-------------------|-----------------|--------------------------------------------------|
| `call-join`       | Client -> Server| `{ workspaceId, userId }`                        |
| `call-join`       | Server -> Peers | `{ userId }` — broadcast to existing participants|
| `call-leave`      | Client -> Server| `{ workspaceId, userId }`                        |
| `call-leave`      | Server -> Peers | `{ userId }` — broadcast to remaining participants|
| `sdp-offer`       | Client -> Server| `{ target, sdp }` — forwarded to target peer     |
| `sdp-answer`      | Client -> Server| `{ target, sdp }` — forwarded to target peer     |
| `ice-candidate`   | Client -> Server| `{ target, candidate }` — forwarded to target peer|

### Server-Side State

```mermaid
flowchart TD
    subgraph callParticipants Map
        W1["workspaceId: 'ws-1'"] --> P1["['0xAlice', '0xBob']"]
        W2["workspaceId: 'ws-2'"] --> P2["['0xCharlie']"]
    end

    J[call-join] -->|Add userId| W1
    L[call-leave] -->|Remove userId| W1
```

### Live Transcription

During active calls, audio streams can be processed for live transcription. Transcription results are broadcast to all call participants over the same WebSocket connection and can be included in workspace digests.

---

## 7. Code-Server Integration

Each workspace can launch a browser-based VS Code instance via code-server. The `CodeTab` component manages the iframe embedding and repo selection.

```mermaid
flowchart TD
    A[User opens Code tab] --> B[CodeTab.tsx loads]
    B --> C{code-server running?}
    C -- No --> D[POST /api/v1/compute/code-server/start]
    D --> E[Launch code-server process on available port]
    E --> F[Return URL: localhost:PORT]
    C -- Yes --> F
    F --> G[Embed in iframe within CodeTab]
    G --> H[User edits code in browser-based editor]
```

### Endpoints

| Method | Path                                    | Description                          |
|--------|-----------------------------------------|--------------------------------------|
| POST   | `/api/v1/compute/code-server/start`     | Start code-server for a workspace    |
| POST   | `/api/v1/compute/code-server/stop`      | Stop code-server instance            |
| GET    | `/api/v1/compute/code-server/status`    | Check if code-server is running      |

---

## 8. Whiteboard

The whiteboard tab embeds a collaborative whiteboard application in an iframe. No dedicated backend routes are required -- the whiteboard state is managed by the embedded application.

---

## 9. Summary of All Workspace Endpoints

| Method | Path                                      | Description                              |
|--------|-------------------------------------------|------------------------------------------|
| GET    | `/api/v1/workspaces`                      | List all workspaces for current user      |
| POST   | `/api/v1/workspaces`                      | Create a new workspace (on-chain + local) |
| GET    | `/api/v1/workspaces/:id`                  | Get workspace details                     |
| DELETE | `/api/v1/workspaces/:id`                  | Delete a workspace                        |
| POST   | `/api/v1/workspaces/:id/invite`           | Generate an invite code                   |
| POST   | `/api/v1/workspaces/join`                 | Join workspace via invite code            |
| GET    | `/api/v1/workspaces/:id/members`          | List workspace members                    |
| DELETE | `/api/v1/workspaces/:id/members/:address` | Remove a member                           |
| POST   | `/api/v1/workspaces/:id/chat`             | Send a chat message                       |
| GET    | `/api/v1/workspaces/:id/chat`             | Get chat messages                         |
| GET    | `/api/v1/workspaces/:id/chat/exports`     | List IPFS chat export CIDs               |
| GET    | `/api/v1/workspaces/:id/digest`           | Get workspace activity digest             |
| GET    | `/api/v1/workspaces/:id/health`           | Get workspace health report               |
| GET    | `/api/v1/repos`                           | List repos                                |
| POST   | `/api/v1/repos/clone`                     | Clone a repo                              |
| POST   | `/api/v1/repos/:id/ipfs/push`             | Push repo to IPFS                         |
| POST   | `/api/v1/repos/ipfs/pull`                 | Pull repo from IPFS                       |
| POST   | `/api/v1/repos/:id/analyze`               | AI repo analysis                          |
| POST   | `/api/v1/compute/code-server/start`       | Start code-server                         |
| POST   | `/api/v1/compute/code-server/stop`        | Stop code-server                          |
| GET    | `/api/v1/compute/code-server/status`      | Code-server status                        |
| WS     | `/ws/agents`                              | WebSocket for call signaling + real-time  |
