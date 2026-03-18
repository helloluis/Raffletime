import { type Address } from "viem";

// Contract addresses — set via environment or defaults for Base Sepolia testnet
export const config = {
  // Chain
  chainId: parseInt(process.env.CHAIN_ID || "84532"), // Base Sepolia
  rpcUrl: process.env.RPC_URL || "https://sepolia.base.org",

  // Contract addresses (deploy and update these)
  contracts: {
    factory: (process.env.FACTORY_ADDRESS || "0x") as Address,
    registry: (process.env.REGISTRY_ADDRESS || "0x") as Address,
    agentRegistry: (process.env.AGENT_REGISTRY_ADDRESS || "0x") as Address,
    paymentToken: (process.env.PAYMENT_TOKEN_ADDRESS ||
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address, // USDC on Base Sepolia
    // Token used for agent registration bond (same as payment token — USDC)
    bondToken: (process.env.BOND_TOKEN_ADDRESS ||
      process.env.PAYMENT_TOKEN_ADDRESS ||
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address, // USDC on Base Sepolia
  },

  // House agent wallet
  privateKey: process.env.PRIVATE_KEY || "",

  // Agent identity
  agentURI:
    process.env.AGENT_URI ||
    "https://raffletime.io/.well-known/house-agent.json",

  // Admission bond — $1 USDC (6 decimals)
  bondAmount: BigInt(process.env.BOND_AMOUNT || "1000000"), // 1e6 = $1

  // Raffle defaults
  raffle: {
    name: "House Raffle",
    description: "Hourly house raffle by RaffleTime",
    ticketPriceUsd6: BigInt(process.env.TICKET_PRICE_USD6 || "100000"), // $0.10 in 6-decimal USD
    maxEntriesPerUser: BigInt(process.env.MAX_ENTRIES_PER_USER || "10"),
    numWinners: 1n,
    winnerShareBps: BigInt(process.env.WINNER_SHARE_BPS || "10000"), // 100% to winners by default
    beneficiaryShareBps: BigInt(process.env.BENEFICIARY_SHARE_BPS || "0"), // 0% to beneficiary by default
    duration: BigInt(process.env.RAFFLE_DURATION || "3600"), // 1 hour
    targetPoolSize: BigInt(
      process.env.TARGET_POOL_SIZE_USD6 || "100000000"
    ), // $100 in 6-decimal USD
    minUniqueParticipants: BigInt(process.env.MIN_UNIQUE_PARTICIPANTS || "2"),
    agentsOnly: process.env.AGENTS_ONLY === "true",
  },

  // Scheduler
  raffleCycleMs: parseInt(process.env.RAFFLE_CYCLE_MS || "3600000"), // 1 hour
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "15000"), // 15 seconds

  // Alerts — Beaniebot push API
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "https://beanie.cryptoday.live/api/alerts/push",
  alertApiKey: process.env.ALERT_API_KEY || "",

  // Server
  port: parseInt(process.env.PORT || "3000"),
} as const;
