# AI Services & Intelligence — Data Flow

All AI inference in OtherThing runs locally via **Ollama**. There are no external API calls for intelligence features. This document covers every AI-powered service, its data flow, and integration points.

---

## Table of Contents

1. [Ollama Chat (SSE)](#1-ollama-chat-sse)
2. [Agent Execution](#2-agent-execution)
3. [Transcription](#3-transcription)
4. [AI Digest](#4-ai-digest)
5. [Handoff Document](#5-handoff-document)
6. [Health Reports](#6-health-reports)
7. [Dispute Analysis](#7-dispute-analysis)
8. [Workspace Tools](#8-workspace-tools)
9. [Semantic Memory (ELID)](#9-semantic-memory-elid)
10. [Service Dependency Graph](#10-service-dependency-graph)
11. [Endpoints Catalog](#11-endpoints-catalog)

---

## 1. Ollama Chat (SSE)

Streaming chat completions via Server-Sent Events. When a `workspaceId` is provided, the handoff document is injected as a system message so the model has full project context.

Model auto-selection prefers `qwen` > `llama` > `gemma` from locally available models.

```mermaid
sequenceDiagram
    participant User as User (Frontend)
    participant API as Express API<br/>localhost:8080
    participant Handoff as Handoff Document
    participant Ollama as Ollama (Local)

    User->>API: POST /api/v1/ollama/chat<br/>{ messages[], workspaceId?, model? }
    API->>API: Auto-select model if not specified<br/>(qwen > llama > gemma)

    alt workspaceId provided
        API->>Handoff: Fetch current handoff doc
        Handoff-->>API: Project state markdown
        API->>API: Inject handoff as system message<br/>prepended to messages[]
    end

    API->>Ollama: POST /api/chat (stream: true)
    loop SSE token stream
        Ollama-->>API: Token chunk
        API-->>User: SSE event: data chunk
    end
    Ollama-->>API: Stream complete
    API-->>User: SSE event: [DONE]
```

---

## 2. Agent Execution

The `AgentAdapter` supports three architectures: **react**, **plan-execute**, and **simple**. All goals are security-scanned before execution. Agents operate in dual mode -- local Ollama or remote via `nodeManager`.

### Tools Available to Agents

| Tool | Description |
|------|-------------|
| `think` | Internal reasoning step (no side effects) |
| `search` | Search workspace content |
| `calculate` | Evaluate mathematical expressions |
| `filesystem` | Read/write/list files in sandboxed paths |
| `sandbox` | Execute code in isolated environment |
| `memory_store` | Store semantic memory (ELID) |
| `memory_search` | Search memories via embeddings |

```mermaid
flowchart TD
    A[User submits goal] --> B{Security Scan}
    B -->|Rejected| C[Return security error]
    B -->|Passed| D[Select architecture]

    D --> E{Architecture}
    E -->|react| F[ReAct Loop]
    E -->|plan-execute| G[Generate Plan → Execute Steps]
    E -->|simple| H[Single-shot Completion]

    F --> I{Execution Mode}
    G --> I
    H --> I

    I -->|local| J[Ollama]
    I -->|remote| K[nodeManager → Remote Node]

    J --> L[Tool Selection]
    K --> L

    L --> M{Tool Call?}
    M -->|Yes| N[Execute Tool]
    N --> O[Collect Result]
    O --> P{Iteration Limit?}
    P -->|No| L
    P -->|Yes| Q[Force Final Answer]

    M -->|No / Final Answer| R[Return Result]
    R --> S[Track Tokens + Iterations]
```

```mermaid
stateDiagram-v2
    [*] --> GoalReceived
    GoalReceived --> SecurityScan
    SecurityScan --> Rejected : flagged
    SecurityScan --> Planning : passed
    Rejected --> [*]

    Planning --> Iterating
    Iterating --> ToolExecution : tool call
    ToolExecution --> Iterating : result
    Iterating --> Complete : final answer
    Iterating --> ForcedStop : iteration limit
    ForcedStop --> Complete
    Complete --> [*]
```

---

## 3. Transcription

Audio from voice/video chat is captured per peer stream using `MediaRecorder` at 15-second intervals. Chunks are sent to the backend, transcribed locally via Ollama's whisper model, aggregated per session, and exported to IPFS on finalize.

```mermaid
sequenceDiagram
    participant Peer as Peer Audio Stream
    participant MR as MediaRecorder
    participant FE as Frontend
    participant API as Express API
    participant Ollama as Ollama (whisper)
    participant Agg as Session Aggregator
    participant IPFS as IPFS

    loop Every 15 seconds per peer
        Peer->>MR: Audio data
        MR->>FE: ondataavailable (audio chunk)
        FE->>API: POST /api/v1/transcription/chunk<br/>{ sessionId, peerId, audioBlob }
        API->>Ollama: Transcribe audio chunk
        Ollama-->>API: { text, segments[] }
        API->>Agg: Append segments to session
        API-->>FE: 200 OK
    end

    FE->>API: POST /api/v1/transcription/finalize<br/>{ sessionId }
    API->>Agg: Collect all segments for session
    Agg-->>API: Full transcript
    API->>IPFS: Pin transcript
    IPFS-->>API: CID
    API-->>FE: { cid, transcript }
```

```mermaid
flowchart LR
    subgraph Frontend
        A[MediaRecorder] -->|15s chunks| B[Chunk Buffer]
    end

    subgraph Backend
        B -->|POST| C[Transcription Endpoint]
        C --> D[Ollama whisper]
        D --> E[Per-Session Aggregator]
    end

    subgraph Storage
        E -->|finalize| F[IPFS Export]
    end
```

---

## 4. AI Digest

A scheduled job running every **12 hours**. Gathers recent workspace artifacts from IPFS (chat logs, transcriptions, whiteboard snapshots), builds a structured prompt, calls Ollama, and parses the JSON response. Suggested tasks are auto-created.

```mermaid
flowchart TD
    A[Scheduler Trigger<br/>Every 12h] --> B[Gather Artifacts from IPFS]

    B --> C[Chat logs<br/>last 12h]
    B --> D[Transcriptions<br/>last 12h]
    B --> E[Whiteboard snapshots<br/>last 12h]

    C --> F[Build Digest Prompt]
    D --> F
    E --> F

    F --> G[Call Ollama]
    G --> H[Parse JSON Response]

    H --> I["{ summary }"]
    H --> J["{ decisions[] }"]
    H --> K["{ issues[] }"]
    H --> L["{ suggestedTasks[] }"]

    L --> M[Auto-create Tasks]
    M --> N[Task Store]

    I --> O[Export Digest to IPFS]
    J --> O
    K --> O
    L --> O
    O --> P[CID stored]

    P --> Q[Trigger Handoff Doc Update]
```

### Digest JSON Schema

```json
{
  "summary": "string — high-level summary of the 12h period",
  "decisions": ["string — each decision made"],
  "issues": ["string — each issue identified"],
  "suggestedTasks": [
    {
      "title": "string",
      "description": "string",
      "priority": "low | medium | high"
    }
  ]
}
```

---

## 5. Handoff Document

A living document updated after each digest cycle. It aggregates the latest digest, current tasks, repository state, and recent decisions into a comprehensive markdown document. This document serves two purposes:

1. Onboarding context for new contributors joining a workspace.
2. System prompt injection for AI chat (see Section 1).

```mermaid
flowchart LR
    A[Latest Digest] --> E[Handoff Generator]
    B[Current Tasks] --> E
    C[Repo State] --> E
    D[Recent Decisions] --> E
    E --> F[Handoff Markdown]
    F --> G[Injected into AI Chat]
    F --> H[Available to Contributors]
```

---

## 6. Health Reports

A scheduled job running every **48 hours**. Computes participation metrics and task velocity, then uses Ollama to generate AI predictions and recommendations.

**Participation metrics:** unique speakers, message counts, artifact counts.

**Task velocity:** created, completed, in-progress, blocked counts over the period.

```mermaid
flowchart TD
    A[Scheduler Trigger<br/>Every 48h] --> B[Compute Participation Metrics]
    A --> C[Compute Task Velocity]

    B --> D[speakers, messages, artifacts]
    C --> E[created, completed, in-progress, blocked]

    D --> F[Build Health Prompt]
    E --> F
    F --> G[Call Ollama]
    G --> H[AI Predictions + Recommendations]
    H --> I[Health Report]
```

---

## 7. Dispute Analysis

When a milestone is disputed, AI can analyze the situation. It gathers all available evidence -- task details, workspace chat, transcriptions, and code -- then prompts Ollama for a structured recommendation. The result is **advisory only** (no automatic on-chain action).

```mermaid
sequenceDiagram
    participant User as Disputing Party
    participant API as Express API
    participant Store as Data Layer
    participant IPFS as IPFS
    participant Ollama as Ollama

    User->>API: Request dispute analysis<br/>{ taskId, milestoneIndex }
    API->>Store: Fetch task details
    Store-->>API: Task + milestone data

    API->>IPFS: Fetch workspace evidence
    IPFS-->>API: Chat logs
    IPFS-->>API: Transcription records
    IPFS-->>API: Code artifacts

    API->>API: Build analysis prompt<br/>(task context + all evidence)
    API->>Ollama: Analyze dispute
    Ollama-->>API: Structured response

    API->>API: Parse recommendation
    Note over API: { action: release | partial | deny,<br/>reasoning: string,<br/>confidence: 0-1 }

    API->>IPFS: Export analysis to IPFS
    IPFS-->>API: CID
    API-->>User: { recommendation, cid }
```

```mermaid
flowchart TD
    A[Dispute Triggered] --> B[Gather Task Context]
    B --> C[Gather Evidence]

    C --> D[Chat History]
    C --> E[Transcription Records]
    C --> F[Code Artifacts]

    D --> G[Build Analysis Prompt]
    E --> G
    F --> G
    B --> G

    G --> H[Ollama Analysis]
    H --> I{Recommendation}

    I -->|release| J[Release full payment]
    I -->|partial| K[Partial release<br/>with split reasoning]
    I -->|deny| L[Deny payment<br/>with evidence summary]

    J --> M[Export to IPFS]
    K --> M
    L --> M
    M --> N[Advisory result<br/>returned to parties]
```

---

## 8. Workspace Tools

AI agents and chat can invoke workspace tools to read and mutate workspace state.

| Tool | Action | Description |
|------|--------|-------------|
| `update_task` | Write | Update task status, assignee, or details |
| `create_task` | Write | Create a new task in the workspace |
| `list_tasks` | Read | List tasks with optional filters |
| `search_chat` | Read | Full-text search across chat history |
| `get_workspace_state` | Read | Snapshot of workspace members, tasks, repos |

---

## 9. Semantic Memory (ELID)

Per-workspace semantic memory using embeddings for storage and retrieval.

| Operation | Description |
|-----------|-------------|
| `memory_store` | Store a text chunk with embedding vector, scoped to workspace |
| `memory_search` | Cosine similarity search over stored embeddings |
| `memory_recent` | Retrieve most recently stored memories |
| `memory_stats` | Count and metadata for workspace memory store |

```mermaid
flowchart LR
    A[Text Input] --> B[Ollama Embeddings]
    B --> C[Vector + Metadata]
    C --> D[Memory Store<br/>per workspace]

    E[Search Query] --> F[Ollama Embeddings]
    F --> G[Query Vector]
    G --> H[Cosine Similarity<br/>against Memory Store]
    H --> I[Ranked Results]
```

---

## 10. Service Dependency Graph

```mermaid
flowchart TD
    subgraph Core
        Ollama[Ollama<br/>Local LLM Runtime]
        IPFS[IPFS<br/>Content-Addressed Storage]
    end

    subgraph Scheduled
        Digest[AI Digest<br/>every 12h]
        Health[Health Reports<br/>every 48h]
    end

    subgraph On-Demand
        Chat[Ollama Chat SSE]
        Agent[Agent Execution]
        Transcription[Transcription]
        Dispute[Dispute Analysis]
    end

    subgraph State
        Handoff[Handoff Document]
        Memory[Semantic Memory ELID]
        Tasks[Task Store]
    end

    Chat --> Ollama
    Chat --> Handoff
    Agent --> Ollama
    Agent --> Memory
    Agent --> Tasks
    Transcription --> Ollama
    Transcription --> IPFS
    Dispute --> Ollama
    Dispute --> IPFS

    Digest --> Ollama
    Digest --> IPFS
    Digest --> Tasks
    Digest --> Handoff
    Health --> Ollama
    Health --> Tasks

    Handoff --> Digest
    Handoff --> Tasks
```

---

## 11. Endpoints Catalog

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| POST | `/api/v1/ollama/chat` | Stream chat completion via SSE | SSE stream |
| POST | `/api/v1/ollama/models` | List available local models | JSON |
| POST | `/api/v1/agent/execute` | Execute agent with goal | JSON (streaming) |
| POST | `/api/v1/transcription/chunk` | Submit audio chunk for transcription | JSON |
| POST | `/api/v1/transcription/finalize` | Finalize session, export to IPFS | JSON { cid } |
| GET | `/api/v1/workspace/:id/digest` | Get latest digest | JSON |
| POST | `/api/v1/workspace/:id/digest/trigger` | Manually trigger digest | JSON |
| GET | `/api/v1/workspace/:id/handoff` | Get current handoff document | Markdown |
| GET | `/api/v1/workspace/:id/health` | Get latest health report | JSON |
| POST | `/api/v1/dispute/:taskId/analyze` | Run AI dispute analysis | JSON |
| POST | `/api/v1/memory/store` | Store semantic memory | JSON |
| POST | `/api/v1/memory/search` | Search semantic memory | JSON |
| GET | `/api/v1/memory/recent` | Get recent memories | JSON |
| GET | `/api/v1/memory/stats` | Get memory statistics | JSON |
