# ModalIn

A decentralized peer-to-peer micro-lending DApp on Ethereum for Indonesian MSMEs.  
Replaces physical collateral with a triple-layer on-chain reputation system built on Soulbound Tokens, Credit Guilds, and ETH-staked peer vouching.

> Academic project — Computer Engineering Program, Department of Electrical Engineering, Universitas Indonesia.  
> IEEE conference paper: [`docs/paper/modalin_ieee_paper.pdf`](docs/paper/modalin_ieee_paper.pdf)

---

## How It Works

Each borrower receives a **Soulbound Token (SBT)** as a non-transferable credit identity (starting score: 500/1000). A composite reputation score drives an algorithmic APR:

| Reputation Signal | Weight |
| --- | --- |
| On-chain payment history | 50% |
| ETH-staked peer vouching | 30% |
| Off-chain oracle attestation | 20% |

APR formula: `BaseRate (12%) + GroupPremium - ReputationDiscount`, clamped to **6%–36%** (OJK reference bounds).

**Credit Guild tiers** based on collective average score:

| Tier | Score Threshold | APR Premium |
| --- | --- | --- |
| Bronze | < 650 | +8% |
| Silver | >= 650 | +4% |
| Gold | >= 800 | +0% |

---

## Smart Contracts

| Contract | Role |
| --- | --- |
| `SoulboundToken` | Non-transferable credit identity; stores repayment history and score |
| `GuildSBT` | Credit group management; Bronze/Silver/Gold tier assignment |
| `VouchRegistry` | ETH-staked peer vouching; slashes stake on borrower default |
| `ReputationEngine` | Composite score aggregator with time-based decay |
| `InterestRateModel` | Algorithmic APR calculation from score and guild tier |
| `LoanEscrow` | Full loan lifecycle: Requested > Active > Repaid/Defaulted |

---

## Prerequisites

- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **npm** v9+
- **MetaMask** browser extension

---

## Getting Started (Local)

### 1. Clone and install dependencies

```bash
git clone https://github.com/calvinkatoroy/blockchain-modalin.git
cd blockchain-modalin

# Smart contract dependencies
cd contracts
npm install

# Frontend dependencies
cd ../modalin-frontend
npm install
```

### 2. Start a local Hardhat node

```bash
# From contracts/
npm run node
```

Starts a local EVM at `http://127.0.0.1:8545` (Chain ID: 31337).  
Note the private keys printed — import at least 2 into MetaMask.

### 3. Deploy contracts

```bash
# From contracts/ (keep the node running in a separate terminal)
npm run deploy:local
```

Deploys all 6 contracts in dependency order and auto-writes ABIs and addresses to `modalin-frontend/src/abis/`.

### 4. Start the frontend

```bash
# From modalin-frontend/
npm run dev
```

Open `http://localhost:3000`.

---

## Deploying to Sepolia Testnet

Create `contracts/.env` from the example:

```bash
cp contracts/.env.example contracts/.env
# Fill in SEPOLIA_RPC_URL and PRIVATE_KEY
```

Then:

```bash
# From contracts/
npm run deploy:sepolia
```

---

## MetaMask Setup (Local)

Add a custom network in MetaMask:

| Field | Value |
| --- | --- |
| Network Name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Symbol | ETH |

---

## Running Tests

```bash
# From contracts/
npm test
```

29 test scenarios covering all 6 contracts (unit + integration), including default/slash and reentrancy paths. All pass.

---

## Repository Structure

```
blockchain-modalin/
├── contracts/               # Hardhat project (smart contracts)
│   ├── contracts/           # 6 Solidity source files
│   ├── scripts/             # deploy.js, demo.js, testRunner.js
│   ├── test/                # ModalIn.test.js (29 scenarios)
│   ├── hardhat.config.js
│   └── package.json
├── modalin-frontend/        # React 19 + Vite + TailwindCSS frontend
│   └── src/
│       ├── App.tsx
│       ├── types.ts
│       └── services/
│           └── contractService.ts
└── docs/
    └── paper/               # IEEE conference paper (LaTeX + PDF)
```

---

## Team

| Name | Role |
| --- | --- |
| Abednego Zebua | Backend / Smart Contract Engineer |
| Calvin Wirathama Katoroy | System & Testing Engineer |
| Wilman Saragih Sitio | Frontend & Web3 Integrator |
