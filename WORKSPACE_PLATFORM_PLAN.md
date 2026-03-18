# OtherThing Workspace Platform — Implementation Plan

> The full vision for decentralized, AI-powered workspace collaboration with on-chain governance.

## Overview

Every workspace is a fully self-contained, local-first collaboration environment. The relationship between wallet keys, workspace membership, and connected nodes makes everything possible — no central server, just IPFS persistence, Appwrite for speed, and smart contracts for trust.

---

## Phase 1: Workspace Collaboration Layer (Current Sprint)

### 1.1 Voice/Video Chat + Transcription
**Status: Voice/video done, transcription TODO**

| Component | Status | Notes |
|-----------|--------|-------|
| WebRTC voice/video via WebSocket signaling | DONE | `useVoiceVideo` hook, mesh topology |
| Mute/unmute, camera toggle | DONE | In ChatTab toolbar |
| Participant indicators | DONE | Avatar pills in call panel |
| **Voice transcription (Whisper via Ollama)** | TODO | Stream audio chunks to local Whisper model |
| **Speaker attribution** | TODO | Match transcription segments to peer stream source |
| **Export transcription to IPFS** | TODO | JSON with `{ speaker, timestamp, text }[]` |
| **Summarize via local model** | TODO | Feed transcript to workspace Ollama model, extract actionable issues |

**Implementation:**
- Use Web Audio API to capture each peer's audio stream separately
- Send audio chunks (every 10-30s) to `POST /api/v1/ollama/transcribe` (new route wrapping Whisper)
- Tag each chunk with `peerId` → resolve to display name
- On call end, compile full transcript, add to IPFS, store CID on workspace
- Trigger summarization: feed transcript to local model with prompt "Extract actionable issues from this meeting transcript"

### 1.2 Code Editor (code-server)
**Status: DONE — iframe + pop-out + repo selector**

| Component | Status | Notes |
|-----------|--------|-------|
| code-server embedded in iframe | DONE | Per-workspace instance |
| Pop-out to own window | DONE | |
| GitHub OAuth repo connection | DONE | RepoConnectionPanel restored |
| IPFS repo storage + sync/pull | DONE | Workspace members share repos via IPFS |
| **Team coding (shared session)** | TODO | LiveShare-style via code-server collaboration |
| **Solo mode toggle** | TODO | Lock repo to single user |

### 1.3 Sandbox Preview
**Status: TODO**

| Component | Status | Notes |
|-----------|--------|-------|
| **Preview iframe** | TODO | New tab or split pane showing `pnpm dev` output |
| **Process management** | TODO | Start/stop dev server from code-server terminal |
| **Port forwarding** | TODO | Auto-detect dev server port, iframe it |

**Implementation:**
- Add a `POST /api/v1/workspaces/:id/sandbox/run` route that spawns `pnpm dev` (or `npm run dev`) in the repo directory
- Capture stdout for port detection (e.g., "listening on port 3000")
- Return the port, embed as iframe alongside code editor
- Kill process on stop or workspace leave

### 1.4 Whiteboard (Excalidraw)
**Status: DONE — iframe + pop-out**

| Component | Status | Notes |
|-----------|--------|-------|
| Excalidraw in iframe | DONE | |
| Pop-out support | DONE | |
| **Export to IPFS** | TODO | Periodic snapshot of canvas state to IPFS |
| **Load from IPFS** | TODO | On workspace join, load latest whiteboard CID |

### 1.5 Team Text Chat
**Status: DONE — display names, polling**

| Component | Status | Notes |
|-----------|--------|-------|
| Team chat with display names | DONE | |
| **Export to IPFS** | TODO | Daily chat log export with metadata |
| **AI summary** | TODO | Summarize day's chat via local model |
| **Move to WebSocket** | TODO | Replace 3s polling with real-time via existing WS |

---

## Phase 2: AI Project Manager Layer

### 2.1 Workspace Activity Digest
**Runs automatically — twice daily (12h interval)**

Collects from all sources:
1. Voice transcriptions (from IPFS CIDs)
2. Text chat messages
3. Whiteboard snapshots (diffs)
4. Code changes (git diff summaries from IPFS repo CIDs)
5. Task board state changes

Feeds all to local model with structured prompt:

```
You are an AI project manager for the workspace "{name}".
Here is all activity from the last 12 hours:

[VOICE TRANSCRIPTS]
...

[CHAT MESSAGES]
...

[CODE CHANGES]
...

[TASK BOARD CHANGES]
...

Based on this activity:
1. Suggest new tasks that should be added to the task tracker
2. Flag any blockers or risks
3. Note any decisions that were made but not yet tracked
```

**Output:** Array of suggested tasks → auto-added to workspace task board as "Suggested" status

### 2.2 Bi-Daily Team Health Report
**Runs every 48 hours**

Prompt includes:
- All digests from the period
- Member participation metrics (who talked, who coded, who was silent)
- Task velocity (created vs completed)
- Milestone progress vs deadlines

Generates:
- Summary of everything discussed
- **Projection of timing/personality conflicts** — e.g., "Alex and Jordan disagreed on the auth approach in two separate calls. The frontend milestone is due in 3 days but no code has been committed for it."
- Recommended actions

### 2.3 Escrow Dispute Resolution
**Triggered when a milestone dispute is raised**

Prompt includes:
- Original task description and milestone requirements
- All related voice transcripts, chat messages, code changes
- Submitted work CID contents
- Any previous milestone outcomes in this task

Generates:
- **Suggested ruling** — release funds, partial release, or deny
- Evidence summary supporting the ruling
- Both parties can see the AI's reasoning before voting

### 2.4 Handoff Document (Source of Truth)
**Continuously updated in IPFS**

The workspace maintains a living document (like HANDOFF.md but auto-generated) that includes:
- Current project state
- All code repos and their latest CIDs
- Active tasks and their status
- Recent decisions from chat/voice
- Architecture notes from whiteboard snapshots
- Team roster and roles

This document is:
- Fed to the AI chat as system context
- Updated after every activity digest
- Stored in IPFS with versioned CIDs
- The source of truth for all AI prompts in the workspace

---

## Phase 3: AI Chat as Workspace Interface

### 3.1 Context-Aware AI Chat
**Status: Ollama chat exists, context TODO**

The workspace AI chat is NOT a general chatbot — it only helps with workspace work.

**Context injection:**
- Latest handoff document (from IPFS)
- Current task board state
- Recent chat summary
- Code repo structure

### 3.2 AI Tool Access (API Hooks)
The local model gets function-calling access to workspace APIs:

| Tool | API | What It Does |
|------|-----|--------------|
| `update_task` | `PUT /api/v1/workspaces/:id/tasks/:taskId` | Move tasks, update status |
| `create_task` | `POST /api/v1/workspaces/:id/tasks` | Add new tasks |
| `update_whiteboard` | Excalidraw API via postMessage | Add/modify whiteboard elements |
| `read_code` | `GET /api/v1/workspaces/:id/sandbox/file` | Read files from repo |
| `write_code` | `PUT /api/v1/workspaces/:id/sandbox/file` | Modify files |
| `search_chat` | `GET /api/v1/workspaces/:id/chat?search=` | Search chat history |
| `get_transcript` | IPFS CID fetch | Pull voice transcripts |

**Permission levels** (set in smart contract when creating workspace):
- `ai_read_only` — AI can see everything but can't modify
- `ai_suggest` — AI can suggest changes (appear as proposals)
- `ai_full_access` — AI can directly update tasks, code, whiteboard

### 3.3 OpenWebUI Integration
**Status: TODO**

Replace the basic Ollama chat proxy with OpenWebUI:
- Embed as iframe (same pattern as Excalidraw/code-server)
- Configure to use workspace's Ollama instance
- Optional web access (permission-gated in smart contract)
- RAG pipeline pulling from workspace IPFS documents

---

## Phase 4: Compute Marketplace

### 4.1 Node Sharing
**Status: NodeRegistry contract deployed, UI stubbed**

| Feature | Status | Notes |
|---------|--------|-------|
| Register node on-chain | DONE | Stake OTT, set hourly rate |
| Browse available nodes | DONE | Marketplace page |
| **Adopt node into workspace** | TODO | `WorkspaceRegistry.addNode()` |
| **Per-minute billing** | TODO | Compute reporting → automatic OTT settlement |
| **Model routing** | TODO | Route inference requests to adopted nodes |

### 4.2 API Key Sharing
**Status: TODO — new feature**

Use case: "I have Claude Code Max ($200/mo). Someone needs it for one job. They pay 20 OTT for one day of access."

| Component | Notes |
|-----------|-------|
| `ApiKeyRegistry` smart contract | Register encrypted API keys with daily rate |
| Key escrow | Encrypted key stored in IPFS, decrypted only by renter's node |
| Usage tracking | Proxy all API calls through provider's node, log token usage |
| Auto-settlement | Daily OTT charge based on actual usage or flat day rate |
| Revenue split | 95% to provider, 5% platform fee |

**Economics example:**
- Provider lists Claude Max at 20 OTT/day
- If rented every day: 20 × 30 = 600 OTT/month revenue on a $200 subscription = ~3x return
- Renter pays $20 for one day instead of committing to $200/month

### 4.3 Platform Fee
**5% on everything:**
- Task escrow releases
- Compute billing
- API key rentals
- Already implemented in `MilestoneEscrow` contract (`platformFee = 500` = 5%)

---

## Phase 5: Smart Contract Permissions

### Workspace Creation Flow
```
1. Owner creates workspace on-chain (WorkspaceRegistry)
2. Sets permission levels:
   - ai_access_level: read_only | suggest | full_access
   - web_access: enabled | disabled
   - compute_sharing: enabled | disabled
   - api_key_sharing: enabled | disabled
3. Creates tasks with milestones (MilestoneEscrow)
4. Escrows OTT per milestone
5. Workers join, accept tasks, work in workspace
6. AI monitors everything, suggests tasks, resolves disputes
7. Milestones complete → payments release → IP registered
```

### On-Chain Data vs Local Data
| On-Chain | Local (IPFS + Appwrite) |
|----------|------------------------|
| Workspace membership & roles | Chat messages |
| Task escrow & milestones | Voice transcripts |
| Payment releases | Code repos |
| Permission levels | Whiteboard state |
| Node registrations | AI digests & summaries |
| API key listings | Handoff documents |
| IP registrations | File storage |
| Agreement signatures | User profiles |

---

## Implementation Priority

### Now (this sprint)
1. ~~Voice/video chat~~ DONE
2. ~~Code editor (code-server)~~ DONE
3. ~~Whiteboard iframe~~ DONE
4. ~~IPFS repo sync~~ DONE
5. ~~User profiles~~ DONE
6. Voice transcription (Whisper)
7. Chat/transcript IPFS export
8. Activity digest (twice daily)

### Next sprint
9. AI context injection (handoff doc)
10. AI tool access (function calling)
11. Sandbox preview iframe
12. OpenWebUI integration
13. Bi-daily team health report

### Following sprint
14. Escrow dispute AI resolution
15. Node adoption into workspaces
16. API key sharing marketplace
17. Per-minute compute billing
18. Smart contract permission UI

---

## Technical Notes

- **All processing is local.** Voice transcription, summarization, and AI chat run on the workspace member's own hardware via Ollama.
- **IPFS provides the shared state.** Every exportable artifact (transcripts, code, whiteboards, digests) gets a CID that any workspace member can fetch.
- **Appwrite is a speed cache, not the source of truth.** IPFS CIDs are authoritative; Appwrite mirrors for fast queries.
- **The chain is for trust.** Escrow, permissions, membership — anything where you need to verify without trusting a central party.
- **Encryption is implicit.** Workspace content is on IPFS (content-addressed, not discoverable), accessible only to nodes with workspace keys.
