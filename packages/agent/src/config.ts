import { type Address } from "viem";

// Contract addresses — set via environment or defaults for Alfajores testnet
export const config = {
  // Chain
  chainId: parseInt(process.env.CHAIN_ID || "11142220"), // Celo Sepolia
  rpcUrl: process.env.RPC_URL || "https://forno.celo-sepolia.celo-testnet.org",

  // Contract addresses (deploy and update these)
  contracts: {
    factory: (process.env.FACTORY_ADDRESS || "0x") as Address,
    registry: (process.env.REGISTRY_ADDRESS || "0x") as Address,
    agentRegistry: (process.env.AGENT_REGISTRY_ADDRESS || "0x") as Address,
    paymentToken: (process.env.PAYMENT_TOKEN_ADDRESS ||
      "0x765DE816845861e75A25fCA122bb6898B8B1282a") as Address, // stablecoin
  },

  // House agent wallet
  privateKey: process.env.PRIVATE_KEY || "",

  // Agent identity
  agentURI:
    process.env.AGENT_URI ||
    "https://raffletime.io/.well-known/house-agent.json",

  // Admission bond (minimum $1, default $1)
  bondAmount: BigInt(process.env.BOND_AMOUNT || "1000000000000000000"), // 1e18 = $1

  // Raffle defaults
  raffle: {
    name: "House Raffle",
    description: "Hourly house raffle by RaffleTime",
    ticketPrice: BigInt(process.env.TICKET_PRICE || "100000000000000000"), // $0.10
    maxEntriesPerUser: 1n,
    numWinners: 1n,
    winnerShareBps: BigInt(process.env.WINNER_SHARE_BPS || "10000"), // 100% to winners by default
    beneficiaryShareBps: BigInt(process.env.BENEFICIARY_SHARE_BPS || "0"), // 0% to beneficiary by default
    duration: BigInt(process.env.RAFFLE_DURATION || "3600"), // 1 hour
    targetPoolSize: BigInt(
      process.env.TARGET_POOL_SIZE || "100000000000000000000"
    ), // $100
    minUniqueParticipants: 2n,
    agentsOnly: process.env.AGENTS_ONLY === "true",
  },

  // Scheduler
  raffleCycleMs: parseInt(process.env.RAFFLE_CYCLE_MS || "3600000"), // 1 hour
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "15000"), // 15 seconds

  // Server
  port: parseInt(process.env.PORT || "3000"),
} as const;
