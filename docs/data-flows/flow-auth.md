# Authentication & Wallet Connection

## Overview

OtherThing Node supports two authentication modes: a **local auth bypass** for the desktop Electron app and a **wallet-based identity** system using Ethereum wallets via WalletConnect. An optional **Appwrite cloud profile** layer allows users to persist display names, avatars, and linked wallet addresses.

---

## 1. Local Auth Bypass

The desktop app runs an Express API at `localhost:8080`. A middleware intercepts every incoming request and injects a mock session, removing the need for any real authentication in local mode.

**Injected session object:**

```json
{
  "userId": "local-user",
  "username": "local",
  "token": "local-token"
}
```

Every API route receives this session on `req.session` (or equivalent), so all permission checks pass transparently.

```mermaid
flowchart TD
    A[Incoming HTTP Request] --> B[Local Auth Middleware]
    B --> C{Is local mode?}
    C -- Yes --> D["Inject mock session\n{ userId: 'local-user',\n  username: 'local',\n  token: 'local-token' }"]
    D --> E[Attach session to req]
    E --> F[next — route handler executes]
    C -- No --> G[Check for wallet/token auth]
    G --> H{Valid token?}
    H -- Yes --> F
    H -- No --> I[401 Unauthorized]
```

---

## 2. Wallet Connection

Users connect an Ethereum wallet (MetaMask, WalletConnect-compatible wallets) through a QR code modal rendered in the Electron renderer. The `Web3Context` React context manages connection state and exposes it to all workspace components.

### Web3Context State

| Field          | Type       | Description                                      |
|----------------|------------|--------------------------------------------------|
| `connected`    | `boolean`  | Whether a wallet is currently connected           |
| `address`      | `string`   | Connected wallet's Ethereum address (checksummed) |
| `myWorkspaces` | `string[]` | Workspace IDs the connected address belongs to    |

### Connection Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Renderer (React)
    participant WC as WalletConnect SDK
    participant Wallet as MetaMask / Mobile Wallet
    participant Ctx as Web3Context

    User->>UI: Click "Connect Wallet"
    UI->>WC: Create session request
    WC-->>UI: Return QR code URI
    UI->>User: Display QR code modal
    User->>Wallet: Scan QR / approve in extension
    Wallet->>WC: Approve session
    WC-->>UI: Session established (address, chainId)
    UI->>Ctx: setConnected(true), setAddress(addr)
    Ctx->>Ctx: Fetch workspace memberships for address
    Ctx-->>UI: Update myWorkspaces[]
    UI->>User: Show connected state, wallet address badge
```

---

## 3. Profile Linking

Links an Ethereum wallet address to an Appwrite cloud profile using a challenge-response signature flow. This proves wallet ownership without exposing private keys.

### Flow

```mermaid
sequenceDiagram
    participant Client as Renderer
    participant API as Express API (localhost:8080)
    participant Wallet as User's Wallet
    participant AW as Appwrite Cloud

    Client->>API: POST /api/v1/profile/wallet-challenge<br/>{ address: "0xABC..." }
    API->>API: Generate random nonce, store with address + expiry
    API-->>Client: { challenge: "Sign this message: nonce=a1b2c3..." }

    Client->>Wallet: Request personal_sign(challenge)
    Wallet->>Client: signature (0x...)

    Client->>API: POST /api/v1/profile/link-wallet<br/>{ address: "0xABC...", signature: "0x..." }
    API->>API: Recover signer from signature + challenge
    API->>API: Verify recovered address === claimed address
    API->>AW: Update profile document — add linked wallet
    API-->>Client: { success: true, profile: { ... } }
```

### Unlinking

```
DELETE /api/v1/profile/unlink-wallet
Body: { address: "0xABC..." }
```

Removes the wallet association from the Appwrite profile. The wallet can then be linked to a different profile.

---

## 4. Appwrite Cloud Profiles

Optional cloud-synced profiles stored in Appwrite. Used for display names, avatars, and cross-device identity persistence.

| Field          | Type     | Description                           |
|----------------|----------|---------------------------------------|
| `userId`       | `string` | Appwrite user ID                      |
| `displayName`  | `string` | User-chosen display name              |
| `avatar`       | `string` | URL or Appwrite file ID for avatar    |
| `walletAddresses` | `string[]` | Linked Ethereum addresses         |
| `bio`          | `string` | Optional profile bio                  |

---

## 5. Session Model Comparison

```mermaid
flowchart LR
    subgraph Local Mode
        LR[Every Request] --> LM[Auth Middleware]
        LM --> LS["Static Session\n{ userId: 'local-user' }"]
        LS --> LH[Route Handler]
    end

    subgraph Wallet Mode
        WR[Every Request] --> WM[Auth Middleware]
        WM --> WT{Token in header?}
        WT -- Yes --> WV[Validate token]
        WV --> WS["Dynamic Session\n{ userId: address,\n  username: ENS/address }"]
        WS --> WH[Route Handler]
        WT -- No --> W4[401 Unauthorized]
    end
```

| Aspect             | Local Mode                        | Wallet Mode                                 |
|--------------------|-----------------------------------|---------------------------------------------|
| Identity           | Fixed: `local-user`               | Ethereum address (e.g., `0xABC...`)          |
| Authentication     | None (auto-injected)              | Wallet signature via WalletConnect            |
| Token              | `local-token` (static)            | JWT or session token from challenge-response  |
| Profile            | Implicit local profile            | Appwrite cloud profile (optional)             |
| Multi-user         | No                                | Yes                                          |
| Persistence        | None needed                       | Token stored in localStorage / secure storage |

---

## 6. Permissions Model

```mermaid
flowchart TD
    subgraph Workspace Permissions
        U[User Address] --> R{Role?}
        R -- Owner --> OP[Owner Permissions]
        R -- Member --> MP[Member Permissions]

        OP --> O1[Create / delete workspace]
        OP --> O2[Invite / remove members]
        OP --> O3[Manage tasks — create, assign, escrow]
        OP --> O4[Configure workspace settings]
        OP --> O5[All member permissions]

        MP --> M1[View workspace content]
        MP --> M2[Send chat messages]
        MP --> M3[Accept assigned tasks]
        MP --> M4[Push / pull repos]
        MP --> M5[Join voice/video calls]
        MP --> M6[Use AI chat and tools]
    end
```

| Permission               | Owner | Member |
|--------------------------|:-----:|:------:|
| Create workspace         |  Yes  |   --   |
| Delete workspace         |  Yes  |   No   |
| Invite members           |  Yes  |   No   |
| Remove members           |  Yes  |   No   |
| Create tasks             |  Yes  |  Yes   |
| Assign tasks             |  Yes  |   No   |
| Escrow funds for tasks   |  Yes  |   No   |
| Accept tasks             |  Yes  |  Yes   |
| Send chat messages       |  Yes  |  Yes   |
| Clone / sync repos       |  Yes  |  Yes   |
| Join calls               |  Yes  |  Yes   |
| Use code-server          |  Yes  |  Yes   |
| View workspace settings  |  Yes  |  Yes   |
| Modify workspace settings|  Yes  |   No   |

---

## API Endpoints Reference

### Auth

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| POST   | `/api/v1/auth/signup`             | Create new account                 |
| POST   | `/api/v1/auth/login`              | Log in, receive session token      |
| POST   | `/api/v1/auth/logout`             | Invalidate current session         |
| GET    | `/api/v1/auth/me`                 | Return current authenticated user  |

### Profile

| Method | Path                              | Description                                   |
|--------|-----------------------------------|-----------------------------------------------|
| GET    | `/api/v1/profile`                 | Get current user's profile                    |
| PUT    | `/api/v1/profile`                 | Update current user's profile (name, avatar)  |
| POST   | `/api/v1/profile/wallet-challenge`| Request a signing challenge for wallet linking |
| POST   | `/api/v1/profile/link-wallet`     | Submit signed challenge to link wallet         |
| DELETE | `/api/v1/profile/unlink-wallet`   | Remove a linked wallet from profile            |
| GET    | `/api/v1/profile/:address`        | Look up profile by Ethereum address            |
