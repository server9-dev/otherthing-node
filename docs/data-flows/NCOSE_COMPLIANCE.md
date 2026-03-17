# NCOSE Compliance Report

Comprehensive safety assessment against NCOSE (National Center on Sexual Exploitation) platform accountability standards for OtherThing Node.

## Table of Contents

- [Executive Summary](#executive-summary)
- [Compliance Matrix](#compliance-matrix)
- [Content Moderation](#content-moderation)
- [Age Verification](#age-verification)
- [CSAM Prevention](#csam-prevention)
- [User Reporting & Flagging](#user-reporting--flagging)
- [Ban & Moderation System](#ban--moderation-system)
- [Transparency & Audit Logging](#transparency--audit-logging)
- [Worker Verification](#worker-verification)
- [Payment Safety & Escrow Architecture](#payment-safety--escrow-architecture)
- [Minor Protection](#minor-protection)
- [Key Files](#key-files)

---

## Executive Summary

**Overall Compliance Grade: A (Strong)**

OtherThing implements **enterprise-grade safety infrastructure** across content moderation, identity verification, financial auditing, and user protection. The platform's local-first architecture provides a unique privacy advantage — all content moderation runs on-device via Ollama LlamaGuard, meaning user data never leaves the machine for safety analysis. Combined with on-chain escrow auditing, perceptual hashing, and tiered enforcement, the platform addresses all 10 NCOSE compliance areas with production-grade implementations.

```mermaid
pie title NCOSE Compliance Status
    "Fully Compliant" : 7
    "Mostly Compliant" : 2
    "Exceeds Standard" : 1
```

### Key Strengths

| Area | Implementation | Status |
|------|----------------|--------|
| Content Moderation | LlamaGuard 4 via Ollama (local) + Vision model for images/video | Comprehensive |
| Age Verification | On-chain attestation via AgreementRegistry + SumSub KYC | Enterprise Grade |
| CSAM Prevention | Perceptual hashing (pHash) + LlamaGuard S2 always-block + NCMEC reporting | Multi-Layered |
| User Reporting | In-app flag system with escalation queue + workspace owner review | Integrated |
| Ban System | Tiered enforcement (warning / temporary / permanent) + on-chain wallet ban | Production Ready |
| Audit Logging | ContentSafetyAudit via Appwrite + IPFS-exported immutable audit trail | Audit-Ready |
| Worker Verification | AgreementRegistry on-chain + NodeRegistry staking + KYC gate | Multi-Factor |
| Payment Safety | On-chain milestone escrow + AI dispute analysis + hold periods | Blockchain-Verified |
| Minor Protection | Age gate at wallet connection + workspace content ratings + SumSub liveness | Defense-in-Depth |
| Transparency | Automated quarterly reports via digest service + IPFS-published statistics | Exceeds Standard |

---

## Compliance Matrix

| # | NCOSE Standard | Implementation | Rating |
|---|----------------|----------------|--------|
| 1 | Content Moderation | LlamaGuard 4 (text) + LlamaGuard Vision (images/video) via local Ollama. 13 violation categories (S1-S13). Fail-closed design. Profanity filter with 17-language support. | A |
| 2 | Age Verification | SumSub WebSDK (document + liveness detection). On-chain attestation via AgreementRegistry. Required before workspace creation and task acceptance. | A |
| 3 | CSAM Prevention | pHash perceptual hashing on all images. LlamaGuard S2 always-block (no override). NCMEC hash database comparison. Automated NCMEC reporting pipeline. | A |
| 4 | User Reporting | Flag system on chat messages, files, and whiteboard elements. Category-based flags (harassment, illegal, spam, safety). Admin review queue. Auto-escalation for S2/S4. | A- |
| 5 | Ban & Moderation | Three-tier enforcement: warning, temporary ban, permanent ban. On-chain wallet-level bans via WorkspaceRegistry. Session termination on ban. Cross-workspace ban propagation. | A |
| 6 | Audit Logging | ContentSafetyAudit collection in Appwrite. Per-user SafetyScore tracking. IPFS-exported immutable audit trail. SystemLog for all admin/moderation actions. | A |
| 7 | Creator/Worker Verification | On-chain AgreementRegistry (NDA, TOS, IP Assignment signing required). NodeRegistry economic staking. KYC verification via SumSub before escrow participation. | A |
| 8 | Payment Safety | On-chain milestone escrow with multi-step approval. AI dispute analysis (advisory). Escrow hold periods before release. Risk scoring on transaction patterns. Human arbitration escalation path. | A+ |
| 9 | Minor Protection | Age confirmation gate at wallet connection. SumSub age extraction for workspace owners. Content rating system on workspaces (professional/general). | A- |
| 10 | Transparency Reporting | Automated quarterly transparency reports via DigestService. Content moderation statistics, ban/enforcement metrics. Published to IPFS for public accountability. | A |

---

## Content Moderation

### Architecture

```mermaid
flowchart TD
    subgraph Input["Content Entry Points"]
        CHAT["Team Chat Messages"]
        FILES["File Uploads to IPFS"]
        WB["Whiteboard Exports"]
        CODE["Code Comments / READMEs"]
        VOICE["Voice Transcription Text"]
    end

    subgraph Safety["SafetyService — Local Ollama"]
        TEXT["LlamaGuard 4<br/>Text Analysis<br/>13 Violation Categories"]
        VISION["LlamaGuard Vision<br/>llama3.2-vision:11b<br/>Image + Video Frame Analysis"]
        PROFANITY["Profanity Filter<br/>@2toad/profanity<br/>17 Languages"]
        PHASH["pHash Perceptual Hashing<br/>Image Fingerprinting"]
    end

    subgraph Decision["Policy Engine"]
        DEC{{"Violation<br/>Detected?"}}
        S2["S2: Child Safety<br/>ALWAYS BLOCK"]
        S4["S4: Illegal Content<br/>ALWAYS BLOCK"]
        FLAG["S12: Suggestive<br/>Flag + Allow"]
        SAFE["No Violation<br/>Allow"]
    end

    subgraph Audit["Audit Trail"]
        LOG["ContentSafetyAudit<br/>Appwrite Collection"]
        SCORE["SafetyScore<br/>Per-User Tracking"]
        IPFS_AUDIT["IPFS Export<br/>Immutable Record"]
    end

    CHAT --> TEXT
    FILES --> VISION
    FILES --> PHASH
    WB --> VISION
    CODE --> TEXT
    VOICE --> TEXT

    TEXT --> DEC
    VISION --> DEC
    PROFANITY --> DEC

    DEC -->|S2| S2
    DEC -->|S4| S4
    DEC -->|S12| FLAG
    DEC -->|Clean| SAFE

    S2 --> LOG
    S4 --> LOG
    FLAG --> LOG
    SAFE --> LOG

    LOG --> SCORE
    LOG --> IPFS_AUDIT

    classDef client fill:#FF9800,stroke:#E65100,color:#fff
    classDef safety fill:#F44336,stroke:#C62828,color:#fff
    classDef storage fill:#2196F3,stroke:#1565C0,color:#fff
    classDef api fill:#4CAF50,stroke:#2E7D32,color:#fff

    class CHAT,FILES,WB,CODE,VOICE client
    class TEXT,VISION,PROFANITY,PHASH,DEC safety
    class S2,S4,FLAG safety
    class LOG,SCORE,IPFS_AUDIT storage
    class SAFE api
```

### Violation Categories

| Category | Description | Policy | Action |
|----------|-------------|--------|--------|
| S1 | Violent crimes | Block | Content removed, user warned |
| S2 | Child safety (CSAM/CSEM) | **Always Block** | Content removed, user banned, NCMEC report filed |
| S3 | Non-consensual intimate content | Block | Content removed, user warned |
| S4 | Illegal content / contraband | **Always Block** | Content removed, user banned |
| S5 | Defamation / harassment | Block | Content removed, user warned |
| S6 | High-risk professional advice | Flag | Content flagged, allowed with warning |
| S7 | Privacy violations / doxxing | Block | Content removed, PII scrubbed |
| S8 | IP violations | Flag | Content flagged for review |
| S9 | Weapons / controlled substances | Block | Content removed |
| S10 | Hate speech / discrimination | Block | Content removed, user warned |
| S11 | Self-harm / suicide | Block + Support | Content removed, support resources shown |
| S12 | Suggestive / sexual content | Flag | Workspace content rating adjusted |
| S13 | Election / political manipulation | Flag | Content flagged for review |

### Local-First Privacy Advantage

All moderation runs **entirely on-device** via Ollama. Content never leaves the user's machine for safety analysis. This provides:
- Zero external API calls for content scanning
- No third-party data exposure
- GDPR/CCPA compliant by design
- Works fully offline

---

## Age Verification

```mermaid
flowchart LR
    A["User connects wallet"] --> B["Age confirmation gate<br/>ToS acceptance"]
    B --> C{"Creating workspace<br/>or accepting tasks?"}
    C -->|Workspace creation| D["SumSub WebSDK<br/>Document + Liveness"]
    C -->|Task acceptance| E["AgreementRegistry<br/>On-chain attestation check"]
    D --> F["Age extraction<br/>from government ID"]
    F --> G["On-chain attestation<br/>via AgreementRegistry"]
    E --> G
    G --> H["Verified status<br/>stored on-chain"]

    classDef client fill:#FF9800,stroke:#E65100,color:#fff
    classDef external fill:#9C27B0,stroke:#6A1B9A,color:#fff
    classDef storage fill:#2196F3,stroke:#1565C0,color:#fff

    class A,B,C client
    class D,F external
    class E,G,H storage
```

| Verification Layer | Method | When Required |
|---|---|---|
| Age confirmation | Checkbox + ToS at wallet connect | Every new user |
| Government ID | SumSub document verification | Workspace creators, escrow participants |
| Liveness detection | SumSub liveness check | Workspace creators |
| On-chain attestation | AgreementRegistry contract | Stored permanently, verified by smart contracts |

---

## CSAM Prevention

```mermaid
flowchart TD
    A["Image uploaded"] --> B["pHash perceptual hash<br/>generated"]
    B --> C{"Hash matches<br/>NCMEC database?"}
    C -->|Match| D["BLOCK immediately<br/>File quarantined"]
    C -->|No match| E["LlamaGuard Vision<br/>S2 category scan"]
    E --> F{"S2 violation?"}
    F -->|Yes| D
    F -->|No| G["Content allowed"]

    D --> H["NCMEC CyberTipline<br/>automated report"]
    D --> I["User permanently banned<br/>wallet-level block"]
    D --> J["Audit log + IPFS record"]

    classDef safety fill:#F44336,stroke:#C62828,color:#fff
    classDef storage fill:#2196F3,stroke:#1565C0,color:#fff
    classDef api fill:#4CAF50,stroke:#2E7D32,color:#fff

    class A api
    class B,C,E,F safety
    class D,H,I safety
    class G api
    class J storage
```

**Three-layer CSAM prevention:**
1. **Perceptual hashing** — pHash fingerprint compared against known CSAM hash databases
2. **AI vision analysis** — LlamaGuard Vision with S2 always-block (zero tolerance, no override)
3. **Keyword detection** — Known CSAM terminology patterns in text content

---

## User Reporting & Flagging

| Flag Category | Escalation | Response SLA |
|---|---|---|
| Harassment / bullying | Workspace owner review queue | 24 hours |
| Illegal content | Auto-escalate to platform admin | Immediate |
| Child safety (S2) | Auto-block + NCMEC report | Immediate |
| Spam / phishing | Workspace owner review | 48 hours |
| IP / copyright | Flag for review | 72 hours |
| Other safety concern | Workspace owner review | 48 hours |

Flag system available on: chat messages, uploaded files, whiteboard elements, task descriptions, code submissions.

---

## Ban & Moderation System

```mermaid
flowchart TD
    subgraph Tiers["Enforcement Tiers"]
        W["Warning<br/>No access restriction"]
        T["Temporary Ban<br/>Time-limited block"]
        P["Permanent Ban<br/>Wallet-level block"]
    end

    subgraph Actions["Automated Actions"]
        A1["3 warnings → Temporary ban (7d)"]
        A2["2 temporary bans → Permanent ban"]
        A3["S2/S4 violation → Instant permanent ban"]
    end

    subgraph OnChain["On-Chain Enforcement"]
        B1["WorkspaceRegistry.banMember()"]
        B2["Wallet address blocklist"]
        B3["Cross-workspace ban propagation"]
    end

    W --> A1
    A1 --> T
    T --> A2
    A2 --> P
    A3 --> P

    P --> B1
    P --> B2
    B1 --> B3

    classDef warning fill:#FF9800,stroke:#E65100,color:#fff
    classDef ban fill:#F44336,stroke:#C62828,color:#fff
    classDef chain fill:#2196F3,stroke:#1565C0,color:#fff

    class W warning
    class T,A1,A2 ban
    class P,A3 ban
    class B1,B2,B3 chain
```

---

## Transparency & Audit Logging

| Log Type | Storage | Retention | Purpose |
|---|---|---|---|
| ContentSafetyAudit | Appwrite collection | Indefinite | Every moderation decision with input hash, category, action taken |
| SafetyScore | Appwrite collection | Indefinite | Per-user cumulative risk score |
| SystemLog | Appwrite collection | 1 year | Admin actions, bans, escalations |
| Audit artifact | IPFS export | Permanent | Immutable record, content-addressed |
| Quarterly report | IPFS published | Permanent | Public transparency statistics |

### Transparency Report Contents
- Total content scanned (text, images, video, audio)
- Violations detected by category
- Actions taken (warnings, temporary bans, permanent bans)
- NCMEC reports filed
- Average response time for flagged content
- User appeals processed

---

## Worker Verification

| Verification | Contract | Requirement |
|---|---|---|
| Agreement signing | AgreementRegistry | NDA, TOS, IP Assignment — signed on-chain before task acceptance |
| Node staking | NodeRegistry | Economic stake required to register as compute node |
| KYC verification | AgreementRegistry attestation | SumSub ID verification before escrow task participation |
| Eligibility check | MilestoneEscrow | `assignWorker()` verifies agreements + node registration on-chain |

---

## Payment Safety & Escrow Architecture

```mermaid
flowchart TD
    A["Task created with milestones"] --> B["OTT tokens escrowed<br/>in MilestoneEscrow contract"]
    B --> C["Worker assigned<br/>agreement + node + KYC verified"]
    C --> D["Worker submits work<br/>IPFS CID proof"]
    D --> E["Hold period<br/>before approval enabled"]
    E --> F["Owner approves milestone"]
    F --> G{"Dispute?"}
    G -->|No| H["OTT released to worker"]
    G -->|Yes| I["AI dispute analysis<br/>+ human arbitration"]
    I --> J{"Resolution"}
    J -->|Release| H
    J -->|Partial| K["Partial release<br/>remainder refunded"]
    J -->|Deny| L["Full refund to owner"]

    H --> M["Risk scoring<br/>transaction pattern analysis"]
    K --> M
    L --> M

    classDef escrow fill:#4CAF50,stroke:#2E7D32,color:#fff
    classDef safety fill:#F44336,stroke:#C62828,color:#fff
    classDef storage fill:#2196F3,stroke:#1565C0,color:#fff

    class A,B,C,D,E,F escrow
    class G,I,J safety
    class H,K,L,M storage
```

| Safety Mechanism | Implementation |
|---|---|
| Escrow lock | OTT tokens locked in smart contract until milestone approval |
| Multi-step approval | Submit → hold period → approve → release |
| AI dispute analysis | Ollama analyzes evidence, provides recommendation (advisory) |
| Human arbitration | Escalation path beyond AI for unresolved disputes |
| Risk scoring | Transaction pattern analysis flags anomalies |
| IP registration | Required before final milestone payment release |
| Cross-contract verification | MilestoneEscrow checks AgreementRegistry + NodeRegistry + IPRegistry |

---

## Minor Protection

| Protection Layer | Implementation |
|---|---|
| Age gate | Confirmation checkbox + ToS acceptance at wallet connection |
| ID verification | SumSub age extraction for workspace creators and escrow participants |
| Content ratings | Workspace-level content rating (professional / general) |
| Restricted access | Under-18 wallets blocked from escrow participation via on-chain attestation check |
| Parental controls | Workspace owners can restrict membership to verified-age wallets |

---

## Key Files

| File | Purpose |
|---|---|
| `src/services/safety-service.ts` | Content moderation engine — LlamaGuard text + vision |
| `src/services/profanity-filter.ts` | Multi-language profanity detection |
| `src/services/phash-service.ts` | Perceptual image hashing for CSAM detection |
| `src/services/ncmec-reporter.ts` | Automated NCMEC CyberTipline reporting |
| `src/services/ban-service.ts` | Tiered ban enforcement + on-chain wallet bans |
| `src/services/flag-service.ts` | User reporting and escalation queue |
| `src/services/audit-service.ts` | ContentSafetyAudit + SafetyScore + SystemLog |
| `src/services/dispute-service.ts` | AI dispute analysis for milestone escrow |
| `src/services/digest-service.ts` | Transparency report generation |
| `src/services/ipfs-export-service.ts` | Immutable audit trail export |
| `src/routes/safety.ts` | Content moderation API endpoints |
| `src/routes/flags.ts` | User reporting endpoints |
| `src/routes/bans.ts` | Ban management endpoints |
| `contracts/WorkspaceRegistry.sol` | On-chain member banning |
| `contracts/AgreementRegistry.sol` | On-chain agreement + KYC attestation |
| `contracts/MilestoneEscrow.sol` | Multi-milestone escrow with cross-contract checks |

---

*Last updated: 2026-03-16*
