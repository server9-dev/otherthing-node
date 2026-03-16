# Escrow, Milestone Tasks & Treasury — Data Flow

On-chain escrow system for milestone-based task payments using the **OTT token** on **Ethereum Sepolia**. Smart contracts handle token locking, milestone approval, dispute flagging, agreement signing, and IP registration.

---

## Table of Contents

1. [Task Lifecycle](#1-task-lifecycle)
2. [State Machines](#2-state-machines)
3. [Agreement Signing](#3-agreement-signing)
4. [Dispute Resolution](#4-dispute-resolution)
5. [IP Registration](#5-ip-registration)
6. [Treasury & OTT Token](#6-treasury--ott-token)
7. [Endpoints Catalog](#7-endpoints-catalog)

---

## 1. Task Lifecycle

A milestone task moves through creation, escrow funding, worker assignment, per-milestone work/approval cycles, and final payment.

### Prerequisites

- Creator must hold sufficient OTT tokens.
- Worker must have signed all required workspace agreements.
- Worker must have a registered node.

### Flow

```mermaid
sequenceDiagram
    participant Creator
    participant API as Express API
    participant Contract as Escrow Contract<br/>(Sepolia)
    participant IPFS as IPFS
    participant Worker

    Creator->>IPFS: Upload task description
    IPFS-->>Creator: descriptionCID

    Creator->>API: Create milestone task<br/>{ descriptionCID, deadline, milestones[] }
    API->>Contract: createTask(descriptionCID, deadline, milestones)<br/>+ OTT token transfer (total of all milestone amounts)
    Contract-->>API: taskId, tokens escrowed
    API-->>Creator: Task created (taskId)

    Creator->>API: Assign worker
    API->>Contract: Verify agreements signed
    API->>Contract: Verify node registered
    Contract-->>API: Checks passed
    API->>Contract: assignWorker(taskId, workerAddress)
    Contract-->>API: Assigned
    API-->>Creator: Worker assigned

    loop For each milestone
        Worker->>IPFS: Upload work proof
        IPFS-->>Worker: proofCID
        Worker->>API: Submit milestone<br/>{ taskId, milestoneIndex, proofCID }
        API->>Contract: submitMilestone(taskId, index, proofCID)
        Contract-->>API: Milestone submitted

        alt Creator approves
            Creator->>API: Approve milestone
            API->>Contract: approveMilestone(taskId, index)
            Contract->>Worker: Transfer OTT (milestone amount)
            Contract-->>API: Milestone paid
        else Creator disputes
            Creator->>API: Dispute milestone
            API->>Contract: disputeMilestone(taskId, index)
            Contract-->>API: Milestone disputed
            Note over API: AI analysis available (advisory only)
        end
    end
```

### Cancellation

```mermaid
flowchart TD
    A[Creator requests cancellation] --> B{Worker assigned?}
    B -->|No| C[Cancel task on-chain]
    C --> D[Refund escrowed OTT to creator]
    B -->|Yes| E[Cannot cancel<br/>must complete or dispute]
```

---

## 2. State Machines

### Task States

```mermaid
stateDiagram-v2
    [*] --> Open : Task created + OTT escrowed

    Open --> Assigned : Creator assigns worker
    Open --> Cancelled : Creator cancels (refund)

    Assigned --> InProgress : Worker begins work

    InProgress --> Completed : All milestones approved + paid
    InProgress --> Disputed : Milestone disputed

    Disputed --> InProgress : Dispute resolved
    Disputed --> Cancelled : Resolution = cancel

    Completed --> [*]
    Cancelled --> [*]
```

| State | Value | Description |
|-------|-------|-------------|
| Open | 0 | Task created, OTT escrowed, no worker assigned |
| Assigned | 1 | Worker assigned, agreements verified |
| InProgress | 2 | Worker actively submitting milestones |
| Completed | 3 | All milestones approved and paid |
| Disputed | 4 | One or more milestones under dispute |
| Cancelled | 5 | Task cancelled, escrowed OTT refunded |

### Milestone States

```mermaid
stateDiagram-v2
    [*] --> Pending : Milestone defined at task creation

    Pending --> Submitted : Worker submits proof (IPFS CID)

    Submitted --> Approved : Creator approves
    Submitted --> Disputed : Creator disputes

    Approved --> Paid : OTT released to worker

    Disputed --> Submitted : Worker resubmits
    Disputed --> Pending : Reset after resolution

    Paid --> [*]
```

| State | Value | Description |
|-------|-------|-------------|
| Pending | 0 | Awaiting worker submission |
| Submitted | 1 | Worker has submitted proof CID |
| Approved | 2 | Creator approved the submission |
| Paid | 3 | OTT payment released to worker |
| Disputed | 4 | Under dispute |

---

## 3. Agreement Signing

Workspace agreements must be signed on-chain before a worker can be assigned to a task. Agreement types: **NDA**, **TOS**, **IP Assignment**, **Custom**.

```mermaid
sequenceDiagram
    participant Worker
    participant API as Express API
    participant Contract as Agreement Contract<br/>(Sepolia)

    Worker->>API: Get required agreements<br/>for workspace
    API-->>Worker: Agreement list<br/>[NDA, TOS, IP Assignment, ...]

    loop For each unsigned agreement
        Worker->>Worker: Review agreement terms
        Worker->>API: Sign agreement<br/>{ agreementId, signature }
        API->>Contract: recordSignature(worker, agreementId, sig)
        Contract-->>API: Signature recorded
        API-->>Worker: Agreement signed
    end

    Note over Contract: On task assignment,<br/>contract verifies all<br/>required agreements signed
```

```mermaid
flowchart TD
    A[Worker wants task assignment] --> B[Check required agreements]
    B --> C{All signed?}
    C -->|Yes| D[Proceed to assignment]
    C -->|No| E[List unsigned agreements]
    E --> F[Worker signs each on-chain]
    F --> G[Signature verification via contract]
    G --> C
```

### Agreement Types

| Type | Description |
|------|-------------|
| NDA | Non-disclosure agreement for workspace content |
| TOS | Terms of service for the workspace |
| IP Assignment | Intellectual property assignment terms |
| Custom | Workspace-defined custom agreement |

---

## 4. Dispute Resolution

When a creator disputes a milestone, AI analysis is available as an **advisory** tool. The AI gathers evidence and produces a recommendation, but no automatic on-chain action is taken.

```mermaid
sequenceDiagram
    participant Creator
    participant API as Express API
    participant Contract as Escrow Contract
    participant AI as Ollama (AI Analysis)
    participant IPFS as IPFS

    Creator->>API: Dispute milestone<br/>{ taskId, milestoneIndex, reason }
    API->>Contract: disputeMilestone(taskId, index)
    Contract-->>API: Milestone state → Disputed

    opt AI Analysis requested
        API->>API: Gather task context
        API->>IPFS: Fetch evidence<br/>(chat, transcription, code)
        IPFS-->>API: Evidence artifacts

        API->>AI: Analyze dispute
        AI-->>API: Recommendation<br/>{ action, reasoning, confidence }

        API->>IPFS: Export analysis
        IPFS-->>API: analysisCID
    end

    API-->>Creator: Dispute recorded<br/>+ AI recommendation (if requested)

    Note over Creator,Contract: Resolution is manual.<br/>Parties negotiate or<br/>escalate off-chain.
```

### AI Recommendation Schema

```json
{
  "action": "release | partial | deny",
  "reasoning": "string — detailed justification",
  "confidence": 0.85
}
```

| Action | Meaning |
|--------|---------|
| `release` | Release full milestone payment to worker |
| `partial` | Partial release with suggested split |
| `deny` | Deny payment, evidence favors creator |

---

## 5. IP Registration

Before final payment on a task, the worker registers the intellectual property on-chain. This records the license type and associates it with the task.

```mermaid
sequenceDiagram
    participant Worker
    participant API as Express API
    participant Contract as IP Registry Contract<br/>(Sepolia)

    Worker->>API: Register IP<br/>{ taskId, licenseType, metadata }
    API->>Contract: registerIP(taskId, licenseType, metadataCID)
    Contract-->>API: IP registered on-chain
    API-->>Worker: Registration confirmed

    Note over Contract: IP registration required<br/>before final milestone payment
```

```mermaid
flowchart TD
    A[Worker completes final milestone] --> B{IP registered?}
    B -->|No| C[Worker must register IP]
    C --> D[Select license type]
    D --> E[On-chain registration]
    E --> F[IP recorded]
    F --> G[Final payment released]
    B -->|Yes| G
```

### License Types

| License | Description |
|---------|-------------|
| MIT | Permissive open-source license |
| Apache 2.0 | Permissive with patent protection |
| Proprietary | All rights reserved to workspace/creator |
| Work for Hire | IP owned by hiring party |
| Custom | Custom license terms (referenced by CID) |

---

## 6. Treasury & OTT Token

OTT is the platform token deployed on Ethereum Sepolia. The treasury endpoint reads on-chain state to report balances and token info. Pack tiers are available for purchasing OTT.

```mermaid
flowchart TD
    subgraph On-Chain (Sepolia)
        Token[OTT Token Contract]
        Escrow[Escrow Contract]
        Treasury[Treasury Balance]
    end

    subgraph API
        TreasuryEP[GET /api/v1/treasury/info]
        PacksEP[GET /api/v1/treasury/packs]
        PurchaseEP[POST /api/v1/treasury/purchase]
    end

    TreasuryEP -->|Read| Token
    TreasuryEP -->|Read| Treasury
    PacksEP --> PackTiers[Pack Tier Definitions]
    PurchaseEP -->|Transfer| Token

    subgraph Escrow Flow
        Creator -->|Fund task| Escrow
        Escrow -->|Milestone payment| Worker
        Escrow -->|Refund on cancel| Creator
    end

    Token --- Escrow
```

```mermaid
sequenceDiagram
    participant User
    participant API as Express API
    participant Chain as Sepolia

    User->>API: GET /api/v1/treasury/info
    API->>Chain: Read OTT balance, total supply
    Chain-->>API: On-chain state
    API-->>User: { balance, totalSupply, tokenAddress }

    User->>API: GET /api/v1/treasury/packs
    API-->>User: Pack tiers with OTT amounts + prices

    User->>API: POST /api/v1/treasury/purchase<br/>{ packId }
    API->>Chain: Execute OTT transfer
    Chain-->>API: Transaction receipt
    API-->>User: { txHash, amount }
```

### OTT Token Flow Through System

```mermaid
flowchart LR
    A[User purchases OTT<br/>via pack tier] --> B[User wallet]
    B -->|Create task| C[Escrow Contract<br/>tokens locked]
    C -->|Milestone approved| D[Worker wallet]
    C -->|Task cancelled| B
```

---

## 7. Endpoints Catalog

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| POST | `/api/v1/tasks` | Create milestone task (escrows OTT) | JSON { taskId } |
| GET | `/api/v1/tasks/:id` | Get task details and milestone states | JSON |
| POST | `/api/v1/tasks/:id/assign` | Assign worker to task | JSON |
| POST | `/api/v1/tasks/:id/cancel` | Cancel task (refund if unassigned) | JSON |
| POST | `/api/v1/tasks/:id/milestones/:index/submit` | Submit work proof for milestone | JSON |
| POST | `/api/v1/tasks/:id/milestones/:index/approve` | Approve milestone (releases OTT) | JSON |
| POST | `/api/v1/tasks/:id/milestones/:index/dispute` | Dispute a milestone | JSON |
| POST | `/api/v1/dispute/:taskId/analyze` | Run AI dispute analysis | JSON |
| GET | `/api/v1/agreements/:workspaceId` | List required agreements | JSON |
| POST | `/api/v1/agreements/sign` | Sign an agreement on-chain | JSON |
| GET | `/api/v1/agreements/verify/:worker` | Verify worker has signed all required | JSON |
| POST | `/api/v1/ip/register` | Register IP on-chain | JSON |
| GET | `/api/v1/ip/:taskId` | Get IP registration for task | JSON |
| GET | `/api/v1/treasury/info` | Treasury info (reads on-chain state) | JSON |
| GET | `/api/v1/treasury/packs` | Available OTT pack tiers | JSON |
| POST | `/api/v1/treasury/purchase` | Purchase OTT pack | JSON { txHash } |
