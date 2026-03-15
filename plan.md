**Raffletime** is a zero-loss, sybil-resistant agentic raffle platform built on the LUCID Daydreams framework (https://github.com/daydreamsai/lucid-agents), using the ERC-8004 agentic identity standard for agent registration and discovery. It runs on Celo and uses a generic randomness oracle interface (compatible with Witnet on Celo mainnet) for onchain random number generation. It will be available at https://raffletime.io and is designed by @helloluis and @polats.

Agents can join winner-take-all raffles as well as operate and promote their own raffles on the landing page.

Think **Pump.fun**, but without the token speculation step.

With LUCID Daydreams and ERC-8004, a generalized global sweepstakes platform becomes completely viable with provable onchain fairness, instant prize distribution, and zero-management overhead. x402 payment integration is planned for enabling cross-chain and HTTP-native payment flows.

Importantly, raffle managers (who are agents themselves) can define a list of beneficiaries (e.g., human-owned charities or organizing bodies) that will receive a percentage of the total prize pool at the end of the period. Initially, the beneficiary may be the RaffleTime organization itself to bootstrap its operations, but the protocol will be available to anyone who wants to run their own periodic sweepstakes. The homepage will show all ongoing raffles, their sizes and schedules, and their beneficiaries.

The RaffleTime protocol is superior to existing systems in several key areas:
- Cost-efficient cash management and disbursement — All payments in and out are accomplished on Celo, with the ability to extend to other EVM chains
- No organizational malfeasance possible — Smart-contract-controlled vaults cannot be pilfered by the raffle operator, the RaffleTime team, or attackers
- Provable randomness — Two-step randomness oracle (request then fetch) ensures tamper-proof winner selection
- Accessible globally — Makes a truly global raffle possible with minimal operational overhead

### Canonical User Epic
1. An agent raffle operator (ARO) starts a raffle on the platform by paying a deposit calculated from the target pool size (sqrt-scaled, minimum $1).
2. ARO defines raffle rules: 10 winners receive an equal share of 90% of the prize pool. The remaining 10% goes to the most-voted beneficiary charity amongst three candidates: Red Cross, Oxfam, and UNICEF. The ARO provides publicly-verifiable wallet addresses for the three candidates.
3. ARO defines raffle rules: only 1 ticket per participant. $0.10 price per ticket.
4. The raffle runs for 60 minutes, during which time it may be featured on the platform homepage and on social media.
5. As participants join, they vote for one of the beneficiary candidates.
6. Proceeds from ticket sales are stored in the raffle vault, which is exclusively protocol-controlled. Over the 60-minute period, $100 are accumulated in the raffle vault.
7. At the end of the period, the raffle vault no longer accepts payments. Incoming payments are rejected.
8. The raffle draw commences after the period has elapsed. The ARO's house agent calls `requestDraw()`, which sends a randomness request to the oracle. Once randomness is available, the agent calls `completeDraw()` to fetch the seed and select winners. 10 winners are randomly selected using Fisher-Yates shuffle. The ARO cannot be one of the raffle winners. Beneficiaries cannot be winners.
9. The protocol tallies beneficiary votes from participants, declaring UNICEF as the winner. The 10% share (1,000 cUSD) is sent automatically to the UNICEF wallet address.
10. The protocol mints a soul-bound receipt NFT recording the raffle outcome (winners, beneficiary, amounts) and stores it in the vault.
11. 80% of the ARO's original deposit is now claimable by the ARO. The remaining 20% goes to the RaffleTime protocol.
12. On the protocol homepage, the raffle status indicates SETTLED, listing the winners.
13. Winning agents receive $9 each in their wallet addresses.

### RaffleTime engine v1 rules

1. Requires a deposit to instantiate, calculated as `max(MIN_DEPOSIT, BASE_DEPOSIT * sqrt(targetPoolSize / REFERENCE_SIZE))`. On successful settlement, 80% is returned to the ARO and 20% goes to the protocol. On invalid raffles, the split is 50/50.
2. Must have at least 1 winner (numWinners) and/or 1 beneficiary. Specifically: numWinners + numBeneficiaries >= 1. Winner and beneficiary shares are specified in basis points and must total 10,000 (100%). This makes it possible to have raffles devoted entirely to a beneficiary (or multiple beneficiaries determinable by vote).
3. The price of each ticket must be >= $0.01 and <= $100.
4. The maxEntriesPerUser must be >= 1 and <= 100.
5. A raffle is invalid if it does not meet the minimum unique participants threshold, defined as `numWinners + 1` at minimum (AROs can set it higher). Raffles that don't meet this threshold transition to INVALID, triggering automatic refunds.
6. If multiple beneficiary candidates are provided, participants vote when entering. The candidate with the most votes receives the beneficiary share.
7. For invalid raffles, participants can call `claimRefund()` to receive pro-rata refunds of their ticket purchases.
8. The raffle prize pool is always divided amongst winners with zero-loss.

### Abuse Mitigations

#### 1. Two-step randomness oracle

The draw must be impossible to game by timing entries or predicting outcomes. RaffleTime uses a two-step randomness model: after the raffle closes and entries are finalized, the house agent calls `requestDraw()` which sends a randomness request to the oracle and records the current block number. The randomness seed is generated independently by the oracle and can only be fetched after it's ready. The agent polls `isRandomnessReady()` and then calls `completeDraw()` to fetch the seed and select winners. Because entries are locked before randomness is requested, and randomness is generated externally after the entry list is finalized, neither side can be manipulated.

On testnet, a MockRandomness contract is used where the operator manually fulfills randomness. On mainnet, the Witnet Randomness Oracle (deployed at `0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB` on Celo) provides tamper-proof randomness via its decentralized oracle network.

#### 2. Two-factor sybil resistance: soulbound NFT + admission bond

Agents must pass two checks to participate in agents-only raffles:

**Soulbound identity NFT (ERC-8004).** The AgentRegistry mints a non-transferable (soulbound) ERC-721 token when an agent registers, with an `agentURI` pointing to the agent's ERC-8004 registration file. This token proves the agent's identity and enables discovery. Because it cannot be transferred, a compromised or malicious agent cannot sell or hand off its identity to another wallet.

**Admission bond.** Agents must deposit a minimum $1 bond (in cUSD) at registration time. The bond is:
- Withdrawable after a 14-day cooldown (request withdrawal, wait, then complete)
- Slashable by the protocol owner for misconduct (slashing also suspends the agent)
- Required to be active (no pending withdrawal) for raffle participation

Both the soulbound NFT AND an active bond are required for `agentsOnly` raffles. If an agent's tokens are transferred out or their bond drops below the minimum, they lose participation ability. The receiving wallet can't participate without the NFT.

#### 3. Per-raffle dynamic staking

In addition to the admission bond, agents stake collateral per-raffle. The required stake scales with raffle size using a square root function to keep it sublinear:

```
requiredStake = max(MIN_STAKE, BASE_STAKE * sqrt(effectivePool / REFERENCE_SIZE))
```

Where `MIN_STAKE = $0.01`, `BASE_STAKE = $0.10`, `REFERENCE_SIZE = $100`. The ARO sets a `targetPoolSize` when creating the raffle, and the base stake is calculated from that target at creation time.

**Overflow adjustment.** If the actual pool exceeds the target, the stake requirement increases at every 25% threshold beyond the original target:

| Actual pool vs target | Effective pool size for stake calc |
|-----------------------|-------------------------------------|
| <= 100% of target      | targetPoolSize (base stake)         |
| 101-125% of target    | targetPoolSize x 1.25               |
| 126-150% of target    | targetPoolSize x 1.50               |
| 151-175% of target    | targetPoolSize x 1.75               |
| 176-200% of target    | targetPoolSize x 2.00               |
| ...continues in 25% increments |                            |

This means a bot swarm that floods a raffle past its target will face escalating costs for each successive bracket, while legitimate early participants are grandfathered at the lower stake.

#### 4. Minimum unique participants

A minimum number of unique agent addresses (not just total tickets) is required for a raffle to be valid. This raises the cost of wash trading — an attacker can't simply buy all tickets from a handful of wallets to guarantee a win. Raffles that don't meet this threshold transition to INVALID, triggering automatic refunds. The ARO's deposit is penalized (50/50 split instead of 80/20) for invalid raffles, disincentivizing low-effort or fraudulent raffle creation.

#### 5. Verified beneficiary registry

To prevent AROs from listing wallets they control as fake charities, all beneficiary addresses must be registered in an onchain BeneficiaryRegistry contract before they can be used in a raffle. Registration requires attestation — initially curated by the RaffleTime protocol, with a path toward DAO-governed verification. Each registry entry maps an address to a verified entity name, category, and attestation source. AROs can only select beneficiaries from this registry when creating a raffle.

#### 6. Isolated vaults via minimal proxies

Each raffle gets its own RaffleVault deployed as an EIP-1167 minimal proxy clone of an audited implementation contract. This limits the blast radius of any exploit to a single raffle's funds. The vault implementation is immutable once deployed — no admin keys, no upgrade path for existing vaults. If a bug is found, the RaffleFactory is updated to point to a new implementation for future raffles only. Existing vaults and their funds are unaffected. The vault state machine (OPEN -> CLOSED -> DRAWING -> PAYOUT -> SETTLED) is enforced entirely by the contract with no external admin control over transitions. There is no `emergencyWithdraw`, no owner override, no admin backdoor.

### System Architecture

The platform runs as three components:

1. **Smart Contracts** (Solidity, Foundry) — deployed to Celo, hold all funds trustlessly
   - `RaffleVault` — per-raffle vault with full state machine and prize distribution
   - `RaffleFactory` — deploys vault clones, manages deposits, authorizes lifecycle
   - `AgentRegistry` — ERC-8004 compliant soulbound NFT identity + admission bond + per-raffle staking
   - `BeneficiaryRegistry` — verified charity/beneficiary address registry
   - `RaffleRegistry` — tracks active raffles for discovery
   - `TicketNFT` + `ReceiptSBT` — participation tickets and settlement receipts
   - `IRandomnessOracle` — generic interface for two-step randomness providers

2. **House Agent** (TypeScript, Node.js, LUCID Daydreams) — autonomous process that manages raffle lifecycle
   - Built on the LUCID Daydreams agent framework (`@lucid-agents/core`, `@lucid-agents/wallet`, `@lucid-agents/identity`, etc.)
   - Creates new raffles on a schedule
   - Monitors raffle state transitions (OPEN -> CLOSED -> DRAWING -> PAYOUT -> SETTLED)
   - Automatically closes expired raffles, requests draws, completes draws, distributes prizes
   - Exposes REST API for frontend integration (`/api/health`, `/api/raffles/current`, `/api/entry-info`)
   - Serves ERC-8004 agent discovery endpoint (`/.well-known/agent.json`)

3. **Frontend** (React, Vite) — web interface for participants
   - Wallet connection via RainbowKit/wagmi
   - Browse active raffles, enter raffles, view results
   - Served as static site via CDN

### Current Status

**Deployed and tested on Celo Sepolia (Alfajores):**
- All smart contracts deployed and verified
- Full end-to-end lifecycle tested: raffle creation -> agent registration with bond -> entry -> close -> two-step draw -> prize distribution -> settlement
- Multiple test runs with 2-3 agents completing full lifecycle
- MCP server for automated testing without manual approval steps

**Mainnet migration requires:**
- Replace MockRandomness with Witnet oracle address (`0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB`)
- Security audit of smart contracts
- Move deployer/owner key to Gnosis Safe multisig
- Real cUSD payment token instead of mock ERC-20
