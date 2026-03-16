# OTT Treasury — Handoff Document

## What Was Built

Full implementation of the OTT Treasury system: yield-bearing token with USDC backing. Users buy OTT at $1, platform fees increase backing, users redeem at floor price minus 5% fee.

## Files Created

### Smart Contracts (`contracts/contracts/`)
- **`MockUSDC.sol`** — Test ERC20 with 6 decimals, public `mint()`
- **`interfaces/IOTT.sol`** — Interface for OTT (mint, burn, burnFrom)
- **`OTTTreasury.sol`** — Core treasury contract
  - `buyOTT(usdcAmount)` — Send USDC, receive OTT at $1
  - `redeemOTT(ottAmount)` — Burn OTT, receive USDC at floor minus fee
  - `depositFees(usdcAmount)` — Platform deposits fees (increases backing)
  - `getBackingPerOTT()` — View: treasury USDC * 1e18 * 1e12 / circulatingOTT
  - `getRedeemAmount(ottAmount)` — View: preview net USDC after fee
  - `setRedemptionFee(bps)` — Owner: default 500 (5%), max 1500 (15%)
  - `pause()` / `unpause()` — Owner: emergency stop

### Tests (`contracts/test/`)
- **`OTTTreasury.test.ts`** — 21 tests, ALL PASSING
  - Run: `cd contracts && npx hardhat test test/OTTTreasury.test.ts`

### Deploy Script (`contracts/scripts/`)
- **`deploy-treasury.ts`** — Deploys MockUSDC + OTTTreasury, grants minter, seeds USDC
  - Run: `cd contracts && npx hardhat run scripts/deploy-treasury.ts --network sepolia`
  - **NOT YET DEPLOYED** — addresses are empty strings in code

### Backend (`src/routes/`)
- **`treasury.ts`** — `GET /api/v1/treasury/info` + `GET /api/v1/treasury/packs`
- **`index.ts`** — Modified: added `registerTreasuryRoutes`

### Backend Service (`src/services/`)
- **`web3-service.ts`** — Modified: added `OTTTreasury` + `USDC` to CONTRACT_ADDRESSES, added `TREASURY_ABI` + `USDC_ABI`

### Frontend Context (`src/renderer/context/`)
- **`Web3Context.tsx`** — Modified:
  - Added: `treasuryContract`, `usdcContract`, `usdcBalance`, `backingPerOTT` state
  - Added: `buyOTT()`, `redeemOTT()`, `refreshTreasuryInfo()` actions
  - Added: TREASURY_ABI, USDC_ABI constants
  - Added: `OTTTreasury` + `USDC` to CONTRACT_ADDRESSES
  - Treasury contracts initialized in all 3 connection paths (WalletConnect, private key, new wallet)

### Frontend Pages (`src/renderer/pages/`)
- **`Treasury.tsx`** — NEW: Full treasury page
  - Buy section: 4 pack cards (100/500/1000/5000) + custom amount
  - Redeem section: input with real-time preview (floor price, gross, fee, net)
  - Stats: treasury balance, backing/OTT, circulating supply, fee %

### Frontend App (`src/renderer/`)
- **`App.tsx`** — Modified: added `/treasury` route + Coins nav icon
- **`components/WalletButton.tsx`** — Modified: shows USDC balance + "~$X.XX backed" under OTT

### PDFs (Generated)
- `C:\Users\omeng\Downloads\OTT_Tokenomics_B2B.pdf`
- `C:\Users\omeng\Downloads\OTT_One_Pager.pdf`
- `C:\Users\omeng\Downloads\OTT_Go_To_Market.pdf`
- `C:\Users\omeng\Downloads\OTT_Whitepaper.pdf`
- Generator script: `/home/alex/generate_pdfs.py`

## What's Left To Do

### Step 1: Deploy to Sepolia
```bash
cd contracts
npx hardhat run scripts/deploy-treasury.ts --network sepolia
```
This will output MockUSDC and OTTTreasury addresses.

### Step 2: Update Contract Addresses
After deploying, paste the addresses into these files:
1. `src/services/web3-service.ts` — `CONTRACT_ADDRESSES.sepolia.OTTTreasury` and `.USDC`
2. `src/renderer/context/Web3Context.tsx` — same two fields

### Step 3: Verify
- `npx hardhat test` — 21 treasury tests pass (3 pre-existing NodeRegistry failures are unrelated)
- `npx tsc --noEmit` — clean
- Open app, connect wallet, navigate to Treasury page
- Buy OTT with USDC, check balances update
- Deposit fees, verify backing increases
- Redeem OTT, verify USDC returned minus fee

## Key Design Decisions
- `circulatingTreasuryOTT` tracked separately from `totalSupply()` — initial 100M deployer OTT doesn't count for backing
- Redeem math: `grossUsdc = (ottAmount * treasuryUsdc) / circulatingTreasuryOTT` — direct calculation avoids decimal precision issues
- Redemption fee stays in treasury (not withdrawn), increasing backing for remaining holders
- No admin withdrawal function — USDC can only leave via user redemptions

## Known Issue
- Vite dev server (localhost:1420) wasn't loading in browser despite responding to curl — likely WSL2 networking. Try `npm run dev` or access via the WSL IP shown in Vite output (e.g., `http://172.19.69.80:1420`)
