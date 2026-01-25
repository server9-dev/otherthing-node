# OtherThing Smart Contracts

Solidity contracts for the OtherThing distributed compute network.

## Contracts

### OTT Token (`OTT.sol`)
ERC20 token with capped supply (1 billion) and minter roles.

- **Symbol**: OTT
- **Max Supply**: 1,000,000,000
- **Initial Supply**: 100,000,000 (10%)

### NodeRegistry (`NodeRegistry.sol`)
Node registration and staking for compute providers.

- Register nodes with stake (min 1000 OTT)
- Report compute work and earn rewards
- Reputation system (0-100%)
- Slashing for bad behavior

### TaskEscrow (`TaskEscrow.sol`)
Payment escrow for compute tasks.

- Create tasks with OTT payment
- 5% platform fee
- Dispute resolution
- Automatic refunds for cancelled tasks

## Deployed Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| OTT | `0x81f3b3391380014e05f85323E97A764607e851Fc` |
| NodeRegistry | `0x610D93a28703Dd7DfC23E3C16A498210997c9B34` |
| TaskEscrow | `0x5643B12c1f7332B7443Ff0F3F1dff422C9460832` |

## Development

```bash
cd contracts

# Install dependencies
npm install

# Compile
npm run compile

# Test
npm run test

# Deploy to localhost
npx hardhat node
npm run deploy:localhost

# Deploy to Sepolia
export PRIVATE_KEY=your_private_key
npm run deploy:sepolia
```

## Environment Variables

```bash
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## Architecture

```
Requester                    Node Owner
    │                             │
    │  createTask(amount)         │
    ▼                             │
┌────────────┐                    │
│ TaskEscrow │◄───────────────────┤ registerNode(stake)
│            │                    │
│  escrow $  │              ┌─────┴─────┐
└─────┬──────┘              │NodeRegistry│
      │                     │            │
      │ assignTask          │  stake $   │
      │ completeTask        │  rewards   │
      ▼                     └─────┬──────┘
┌────────────┐                    │
│Orchestrator│────────────────────┤ reportCompute
│            │                    │
└────────────┘                    ▼
                            ┌──────────┐
                            │ OTT Token│
                            │          │
                            │  mint()  │
                            └──────────┘
```

## License

MIT
