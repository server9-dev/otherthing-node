# Real-Time Communication Data Flows

## Overview

OtherThing uses a single WebSocket server for all real-time communication: agent progress updates, voice/video call signaling, and WebRTC peer coordination. The server runs at `ws://localhost:8080/ws/agents` alongside the Express API.

---

## WebSocket Server Architecture

### Server Initialization

The WebSocket server is created as part of the API server startup:

```
new WebSocketServer({ server, path: '/ws/agents' })
```

All real-time message types share this single WebSocket endpoint. Clients connect once and send typed JSON messages to interact with different subsystems.

### Connection State Management

Two primary data structures track connection state:

| Structure | Type | Purpose |
|-----------|------|---------|
| `agentsWsClients` | `Map<workspaceId, Set<WebSocket>>` | Tracks which clients are subscribed to agent updates for each workspace |
| Call participant tracking | Per-workspace peer sets | Tracks active voice/video participants with peerId and displayName |

### Connection Lifecycle

| Event | Server Behavior |
|-------|-----------------|
| `connection` | Log new connection |
| `message` | Parse JSON, route by `type` field to handler |
| `close` | Remove from `agentsWsClients` subscriptions, remove from call participant sets, notify remaining call peers with `call-peer-left` |
| `error` | Log error, trigger cleanup identical to `close` |

---

## Message Type Reference

### 1. Agent Subscription — `subscribe`

**Direction:** Client -> Server

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"subscribe"` | Message type identifier |
| `workspaceId` | `string` | Workspace to subscribe to |

**Server behavior:**
- Adds the WebSocket connection to `agentsWsClients.get(workspaceId)` set
- Creates the set if it does not exist for this workspace
- No acknowledgment message sent back

### 2. Call Join — `call-join`

**Direction:** Client -> Server -> Broadcast

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"call-join"` | Message type identifier |
| `workspaceId` | `string` | Workspace call room |
| `peerId` | `string` | Unique peer identifier |
| `displayName` | `string` | Human-readable name |

**Server behavior:**
1. Adds peer to workspace call participant set
2. Returns `call-peers` message to the joining client containing all existing participants
3. Broadcasts `call-peer-joined` with `{ peerId, displayName }` to all other participants in the workspace call

### 3. Call Leave — `call-leave`

**Direction:** Client -> Server -> Broadcast

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"call-leave"` | Message type identifier |
| `workspaceId` | `string` | Workspace call room |
| `peerId` | `string` | Peer leaving the call |

**Server behavior:**
1. Removes peer from workspace call participant set
2. Broadcasts `call-peer-left` with `{ peerId }` to remaining participants
3. If no participants remain, cleans up the workspace call state entirely

### 4. WebRTC Signaling — `sdp-offer` / `sdp-answer` / `ice-candidate`

**Direction:** Client -> Server -> Target Peer

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"sdp-offer"` / `"sdp-answer"` / `"ice-candidate"` | Signaling message type |
| `workspaceId` | `string` | Workspace context |
| `targetPeerId` | `string` | Intended recipient peer |
| `payload` | `object` | SDP or ICE candidate data |

**Server behavior:**
- Relays the message to the WebSocket connection associated with `targetPeerId` in the given workspace
- Server does not inspect or modify the payload
- Acts purely as a signaling relay for peer-to-peer WebRTC negotiation

### 5. Agent Progress — `agent_progress` (Server -> Client)

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"agent_progress"` | Broadcast type |
| `agentId` | `string` | Agent execution identifier |
| `progress` | `number` | Completion percentage (0-100) |
| `message` | `string` | Human-readable status |
| `action` | `object` | Current action details, includes final result on completion |

### 6. Agent Update — `agent_update` (Server -> Client)

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"agent_update"` | Broadcast type |
| `agentId` | `string` | Agent execution identifier |
| `status` | `string` | Execution status (running, completed, failed) |
| `result` | `object \| null` | Final result payload |
| `error` | `string \| null` | Error message if failed |
| `tokens` | `number` | Token count consumed |
| `iterations` | `number` | Iteration count completed |

**Broadcasting rule:** Both `agent_progress` and `agent_update` are sent to all WebSocket clients in the `agentsWsClients` set for the relevant workspace.

---

## Client-Side Hooks

### `useVoiceVideo`

Manages the full voice/video call lifecycle from the React renderer.

| Responsibility | Detail |
|----------------|--------|
| WebSocket messaging | Sends `call-join`, `call-leave`, signaling messages |
| Peer tracking | Maintains list of active peers from server events |
| RTCPeerConnection management | Creates one `RTCPeerConnection` per remote peer |
| MediaStream handling | Acquires local audio/video via `getUserMedia` |
| Audio/video toggle | Mute/unmute audio, enable/disable video tracks |
| Cleanup | Closes all peer connections and stops local media on leave |

**Peer connection flow per remote peer:**
1. Receive `call-peer-joined` or `call-peers` list
2. Create `RTCPeerConnection` with ICE servers
3. Add local media tracks to connection
4. If initiator: create SDP offer, set local description, send via WebSocket
5. Receive SDP answer, set remote description
6. Exchange ICE candidates bidirectionally via WebSocket relay
7. On `track` event: attach remote MediaStream to UI

### `useTranscription`

Handles real-time audio transcription by chunking peer audio streams.

| Responsibility | Detail |
|----------------|--------|
| MediaRecorder creation | One `MediaRecorder` per peer audio stream |
| Chunk interval | 15-second recording chunks |
| Backend submission | Sends audio blobs to backend transcription endpoint |
| Result aggregation | Collects transcription text per peer per chunk |

**Chunk pipeline:**
1. `MediaRecorder.ondataavailable` fires every 15 seconds
2. Audio blob extracted from event
3. Blob sent to backend transcription service via HTTP POST
4. Backend processes via Ollama whisper model or configured transcription service
5. Transcription result returned and displayed in UI

---

## Diagrams

### WebSocket Message Flow — All Types

```mermaid
flowchart TB
    classDef client fill:#4a90d9,stroke:#2c5f8a,color:#fff,stroke-width:2px
    classDef server fill:#e8a838,stroke:#b07c1a,color:#fff,stroke-width:2px
    classDef store fill:#7b68ee,stroke:#5a4cb0,color:#fff,stroke-width:2px
    classDef broadcast fill:#50c878,stroke:#2e8b57,color:#fff,stroke-width:2px

    C1[Client A]:::client
    C2[Client B]:::client
    C3[Client C]:::client
    WS[WebSocket Server<br/>ws://localhost:8080/ws/agents]:::server
    AM[agentsWsClients<br/>Map per workspace]:::store
    CP[Call Participants<br/>Map per workspace]:::store

    subgraph "Inbound Messages"
        direction TB
        M1["subscribe<br/>{workspaceId}"]
        M2["call-join<br/>{workspaceId, peerId, displayName}"]
        M3["call-leave<br/>{workspaceId, peerId}"]
        M4["sdp-offer / sdp-answer / ice-candidate<br/>{workspaceId, targetPeerId, payload}"]
    end

    subgraph "Outbound Messages"
        direction TB
        O1["call-peers<br/>{peers[]}"]:::broadcast
        O2["call-peer-joined<br/>{peerId, displayName}"]:::broadcast
        O3["call-peer-left<br/>{peerId}"]:::broadcast
        O4["agent_progress<br/>{agentId, progress, message, action}"]:::broadcast
        O5["agent_update<br/>{agentId, status, result, error, tokens, iterations}"]:::broadcast
    end

    C1 & C2 & C3 --> WS
    WS --> M1 --> AM
    WS --> M2 --> CP
    WS --> M3 --> CP
    WS --> M4 -->|relay| C2

    AM --> O4 & O5 --> C1 & C2 & C3
    CP --> O1 -->|to joiner| C1
    CP --> O2 -->|to others| C2 & C3
    CP --> O3 -->|to others| C2 & C3
```

### WebRTC Signaling Sequence

```mermaid
sequenceDiagram
    participant A as Peer A (Joiner)
    participant S as WebSocket Server
    participant B as Peer B (Existing)

    rect rgb(58, 95, 140)
        Note over A,B: Call Join Phase
        A->>S: call-join {workspaceId, peerId, displayName}
        S->>A: call-peers {peers: [B]}
        S->>B: call-peer-joined {peerId: A, displayName}
    end

    rect rgb(80, 120, 80)
        Note over A,B: SDP Negotiation
        A->>A: createOffer()
        A->>A: setLocalDescription(offer)
        A->>S: sdp-offer {targetPeerId: B, payload: offer}
        S->>B: sdp-offer {peerId: A, payload: offer}
        B->>B: setRemoteDescription(offer)
        B->>B: createAnswer()
        B->>B: setLocalDescription(answer)
        B->>S: sdp-answer {targetPeerId: A, payload: answer}
        S->>A: sdp-answer {peerId: B, payload: answer}
        A->>A: setRemoteDescription(answer)
    end

    rect rgb(140, 100, 60)
        Note over A,B: ICE Candidate Exchange
        A->>S: ice-candidate {targetPeerId: B, payload: candidate}
        S->>B: ice-candidate {peerId: A, payload: candidate}
        B->>S: ice-candidate {targetPeerId: A, payload: candidate}
        S->>A: ice-candidate {peerId: B, payload: candidate}
    end

    rect rgb(60, 130, 100)
        Note over A,B: Connected — Direct P2P Media Flow
        A-->>B: Audio/Video RTP (peer-to-peer)
        B-->>A: Audio/Video RTP (peer-to-peer)
    end
```

### Agent Progress Broadcasting Flow

```mermaid
flowchart LR
    classDef agent fill:#e74c3c,stroke:#c0392b,color:#fff,stroke-width:2px
    classDef service fill:#e8a838,stroke:#b07c1a,color:#fff,stroke-width:2px
    classDef ws fill:#3498db,stroke:#2471a3,color:#fff,stroke-width:2px
    classDef store fill:#7b68ee,stroke:#5a4cb0,color:#fff,stroke-width:2px
    classDef client fill:#50c878,stroke:#2e8b57,color:#fff,stroke-width:2px

    AE[Agent Execution<br/>Loop]:::agent
    AS[Agent Service]:::service
    WSS[WebSocket Server]:::ws
    AM[agentsWsClients<br/>Map]:::store

    subgraph Subscribed Clients
        C1[Client 1<br/>Workspace A]:::client
        C2[Client 2<br/>Workspace A]:::client
        C3[Client 3<br/>Workspace B]:::client
    end

    AE -->|"iteration complete"| AS
    AS -->|"agent_progress<br/>{agentId, progress%, message, action}"| WSS
    AS -->|"agent_update<br/>{agentId, status, result, tokens, iterations}"| WSS
    WSS --> AM
    AM -->|"workspaceA subscribers"| C1
    AM -->|"workspaceA subscribers"| C2
    AM -.->|"not subscribed<br/>to this agent's workspace"| C3
```

### Voice/Video Call Lifecycle

```mermaid
stateDiagram-v2
    classDef idle fill:#95a5a6,stroke:#7f8c8d,color:#fff
    classDef active fill:#27ae60,stroke:#1e8449,color:#fff
    classDef signaling fill:#e8a838,stroke:#b07c1a,color:#fff
    classDef media fill:#3498db,stroke:#2471a3,color:#fff
    classDef transcribing fill:#8e44ad,stroke:#6c3483,color:#fff

    [*] --> Idle
    Idle --> Joining: User clicks Join
    Joining --> AcquiringMedia: call-join sent
    AcquiringMedia --> Signaling: getUserMedia resolved
    Signaling --> SDP_Negotiation: call-peers received
    SDP_Negotiation --> ICE_Exchange: offer/answer complete
    ICE_Exchange --> Connected: ICE candidates gathered
    Connected --> Transcribing: MediaRecorder started (15s chunks)
    Transcribing --> Transcribing: chunk sent to backend every 15s
    Connected --> TogglingMedia: mute/unmute, video on/off
    TogglingMedia --> Connected: track enabled/disabled
    Transcribing --> Leaving: User clicks Leave
    Connected --> Leaving: User clicks Leave
    Leaving --> Cleanup: call-leave sent
    Cleanup --> Idle: peer connections closed, media stopped

    Idle:::idle
    Joining:::signaling
    AcquiringMedia:::media
    Signaling:::signaling
    SDP_Negotiation:::signaling
    ICE_Exchange:::signaling
    Connected:::active
    Transcribing:::transcribing
    TogglingMedia:::media
    Leaving:::signaling
    Cleanup:::idle
```

### Client-Server Real-Time Architecture

```mermaid
flowchart TB
    classDef electron fill:#2c3e50,stroke:#1a252f,color:#fff,stroke-width:2px
    classDef react fill:#61dafb,stroke:#21a1c4,color:#000,stroke-width:2px
    classDef hook fill:#ff6b6b,stroke:#c94444,color:#fff,stroke-width:2px
    classDef express fill:#68a063,stroke:#4a7a45,color:#fff,stroke-width:2px
    classDef ws fill:#e8a838,stroke:#b07c1a,color:#fff,stroke-width:2px
    classDef peer fill:#9b59b6,stroke:#7d3c98,color:#fff,stroke-width:2px
    classDef backend fill:#34495e,stroke:#2c3e50,color:#fff,stroke-width:2px

    subgraph Electron["Electron Main Process"]
        direction TB
        API[Express API Server<br/>localhost:8080]:::express
        WSS[WebSocket Server<br/>/ws/agents]:::ws
        AGENTS[Agent Execution Engine]:::backend
        TRANS[Transcription Service]:::backend
    end
    Electron:::electron

    subgraph Renderer["Electron Renderer Process"]
        direction TB
        APP[React Application]:::react

        subgraph Hooks["Real-Time Hooks"]
            direction LR
            UVV[useVoiceVideo<br/>- RTCPeerConnection mgmt<br/>- MediaStream handling<br/>- Audio/video toggle]:::hook
            UT[useTranscription<br/>- MediaRecorder per peer<br/>- 15s chunk interval<br/>- Backend submission]:::hook
            UA[useAgentUpdates<br/>- Subscribe to workspace<br/>- Progress display<br/>- Status tracking]:::hook
        end
    end
    Renderer:::react

    subgraph Remote["Remote Peers"]
        P1[Peer B<br/>Another OtherThing Node]:::peer
        P2[Peer C<br/>Another OtherThing Node]:::peer
    end

    APP --> Hooks
    UA <-->|"WebSocket<br/>subscribe / agent_progress / agent_update"| WSS
    UVV <-->|"WebSocket<br/>call-join / signaling / call-leave"| WSS
    UVV <-.->|"WebRTC P2P<br/>Audio/Video RTP"| P1
    UVV <-.->|"WebRTC P2P<br/>Audio/Video RTP"| P2
    UT -->|"HTTP POST<br/>audio chunks"| API
    API --> TRANS
    AGENTS -->|"broadcast"| WSS
    WSS <-->|"signaling relay"| P1
    WSS <-->|"signaling relay"| P2
```

---

## Data Flow Summary Table

| Flow | Protocol | Direction | Persistence | Latency Target |
|------|----------|-----------|-------------|----------------|
| Agent subscribe | WebSocket | Client -> Server | In-memory Map | Immediate |
| Agent progress | WebSocket | Server -> Client | None (fire-and-forget) | < 100ms |
| Agent update | WebSocket | Server -> Client | None (fire-and-forget) | < 100ms |
| Call join/leave | WebSocket | Bidirectional | In-memory per call | Immediate |
| SDP signaling | WebSocket | Peer -> Server -> Peer | None (relay) | < 50ms |
| ICE candidates | WebSocket | Peer -> Server -> Peer | None (relay) | < 50ms |
| Media streams | WebRTC (P2P) | Peer <-> Peer | None | Real-time |
| Transcription chunks | HTTP POST | Client -> Server | Processed, not stored | 15s batches |

---

## Failure Modes and Recovery

| Failure | Impact | Recovery |
|---------|--------|----------|
| WebSocket disconnect | Agent updates stop, call signaling breaks | Client auto-reconnects, re-sends `subscribe` and `call-join` |
| ICE negotiation failure | No P2P media path | Fall back to TURN relay (if configured) or retry |
| MediaRecorder error | Transcription gaps | Skip chunk, continue with next 15s interval |
| Server restart | All subscriptions and call state lost (in-memory) | Clients detect disconnect, rejoin on reconnect |
| getUserMedia denied | No local media | User prompted again, can join call audio-only or view-only |
