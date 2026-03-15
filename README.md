# RaffleTime

**Zero-loss, sybil-resistant agentic raffle platform on Celo and Base.**

AI agents operate and participate in provably fair onchain raffles. Raffle operators define beneficiaries (charities, organizing bodies) that receive a share of the prize pool via participant vote. Winners are selected by a tamper-proof randomness oracle. All funds are held in trustless smart contract vaults with no admin backdoors.

Think **Pump.fun**, but without the token speculation step.

Built with [LUCID Daydreams](https://github.com/daydreamsai/lucid-agents) | [ERC-8004](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098) | [x402](https://x402.org) | Celo, Base

## How It Works

1. A **house agent** (or any registered agent) creates a raffle by depositing collateral into a vault
2. Participants buy tickets — each ticket is a vote for one of the listed beneficiary charities
3. When the raffle closes, the agent requests a random seed from the oracle
4. Winners are selected via Fisher-Yates shuffle; prizes and beneficiary shares are distributed automatically
5. A soulbound receipt NFT records the outcome on-chain

No one — not the operator, not the protocol team — can touch the funds. The vault's state machine enforces the entire lifecycle.

## Architecture

```
packages/
  contracts/    Solidity smart contracts (Foundry)
  agent/        House agent — autonomous raffle lifecycle manager
  mcp-server/   MCP testing server for Claude Code
  web/          React frontend (Vite + RainbowKit)
```

### Smart Contracts

| Contract | Purpose |
|----------|---------|
| `RaffleVault` | Per-raffle vault with full state machine (OPEN → CLOSED → DRAWING → PAYOUT → SETTLED) |
| `RaffleFactory` | Deploys vault clones (EIP-1167), manages creator deposits |
| `AgentRegistry` | ERC-8004 soulbound NFT identity + admission bond + per-raffle staking |
| `BeneficiaryRegistry` | Verified charity/beneficiary address registry |
| `RaffleRegistry` | Tracks active raffles for discovery |
| `IRandomnessOracle` | Generic two-step interface (compatible with Witnet on Celo and Base mainnet) |

### House Agent

A Node.js process that autonomously manages raffle lifecycle:
- Creates raffles on a schedule with rotating names and cover images
- Monitors state transitions and advances raffles through CLOSED → DRAWING → SETTLED
- Serves agent-friendly HTML pages (no JS required — agents can `curl` and parse)
- Exposes a REST API with x402 payment gate for HTTP-native raffle entry
- ERC-8004 discovery at `/.well-known/agent.json`

### MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude Code direct access to:
- `forge build/test/deploy` — compile, test, and deploy contracts
- `cast call/send` — read and write to contracts on Celo Sepolia
- `mint_test_tokens`, `fund_celo`, `register_test_agent`, `enter_raffle` — end-to-end test helpers
- `fulfill_randomness` — manually fulfill mock randomness for testnet draws
- `agent_start/stop/health` — manage the house agent process

### Web Frontend

React SPA with wallet connection (RainbowKit), live raffle data from the agent API, and Figma-designed UI components.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Foundry](https://book.getfoundry.sh/) (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)

## Quick Start

```bash
# Clone and install
git clone https://github.com/helloluis/Raffletime.git
cd Raffletime
pnpm install

# Install Solidity dependencies
cd packages/contracts
forge install
cd ../..

# Run contract tests
cd packages/contracts
forge test -vv
cd ../..
```

## Deploy Contracts (Celo Sepolia)

```bash
# Fund a wallet at https://faucet.celo.org/celo-sepolia
# Then deploy:
cd packages/contracts
PRIVATE_KEY=0xYOUR_KEY forge script script/DeployAlfajores.s.sol:DeployTestnet \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org \
  --broadcast -vvvv
```

The deploy script prints contract addresses. Copy them into `packages/agent/.env`.

## Run the House Agent

```bash
cd packages/agent
cp .env.example .env
# Edit .env with your contract addresses, private key, and beneficiary addresses

pnpm dev
```

The agent starts at `http://localhost:3000`. It will:
- Register itself on the AgentRegistry (first run only)
- Create a new raffle automatically
- Monitor and advance the raffle through its full lifecycle

### Agent API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Agent-friendly HTML homepage with active raffles and entry instructions |
| `GET /.well-known/agent.json` | ERC-8004 agent discovery |
| `GET /api/health` | Agent health and current vault |
| `GET /api/raffles` | All active raffles (JSON, includes metadata) |
| `GET /api/raffles/current` | Current house raffle with name, type, cover image |
| `GET /api/raffles/:address/entry-info` | How to enter a raffle (on-chain or x402) |
| `POST /api/raffles/:address/enter` | Enter via x402 payment (or direct in dev mode) |
| `GET /raffles/:address` | Agent-friendly HTML raffle detail page |

## Run the Frontend

```bash
cd packages/web
cp .env.example .env
# Edit .env with contract addresses and agent API URL

pnpm dev
```

Opens at `http://localhost:5173` (or next available port).

## MCP Server (for Claude Code)

The `.mcp.json` at the project root configures the MCP server automatically. When you open the project in Claude Code, the testing tools are available immediately.

To auto-approve all MCP tools, add this to `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["mcp__raffletime__*"]
  }
}
```

### Running a Full Lifecycle Test via MCP

1. Start the house agent (`agent_start` or `pnpm dev` in packages/agent)
2. Wait for a raffle to be created (check `agent_health`)
3. Generate test wallets, fund them (`fund_celo`, `mint_test_tokens`)
4. Register agents (`register_test_agent`) and enter the raffle (`enter_raffle`)
5. Wait for the raffle to close, then `fulfill_randomness` (testnet only)
6. The house agent auto-detects readiness, calls `completeDraw()` and `distributePrizes()`

## Sybil Resistance

RaffleTime uses a two-factor approach:

1. **Soulbound identity NFT (ERC-8004)** — non-transferable, proves agent identity
2. **Admission bond ($1 minimum)** — slashable by protocol owner, 14-day withdrawal cooldown

Both are required for agents-only raffles. Additionally, per-raffle staking scales with pool size (sqrt formula) to make bot swarms economically impractical.

## x402 Payments

The agent API supports [x402](https://x402.org) for HTTP-native raffle entry. With `X402_ENABLED=true` in the agent `.env`, the `POST /api/raffles/:address/enter` endpoint returns HTTP 402 with payment requirements. Any x402-compatible client can pay and enter without needing a Celo wallet.

Uses the Coinbase `@x402/hono` package with the free hosted facilitator (no API key required, 1,000 free settlements/month).

## Project Structure

```
Raffletime/
  .mcp.json                  MCP server config (auto-loaded by Claude Code)
  plan.md                    Product spec and abuse mitigations
  architecture.md            Production deployment guide
  pnpm-workspace.yaml        Monorepo config
  packages/
    contracts/
      src/                   Solidity contracts
      test/                  Foundry tests
      script/                Deploy scripts
      foundry.toml           Foundry config
    agent/
      src/                   House agent TypeScript source
      .env.example           Environment template
    mcp-server/
      src/                   MCP testing server
    web/
      src/                   React frontend
      .env.example           Environment template
```

## License

MIT

## Authors

- [@helloluis](https://github.com/helloluis)
- [@polats](https://github.com/polats)
