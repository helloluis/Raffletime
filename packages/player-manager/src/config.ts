import "dotenv/config";
import { type Address } from "viem";

export const config = {
  chainId: parseInt(process.env.CHAIN_ID || "11142220"),
  rpcUrl: process.env.RPC_URL || "https://forno.celo-sepolia.celo-testnet.org",

  // Contracts
  paymentToken: (process.env.PAYMENT_TOKEN_ADDRESS || "0x") as Address,
  agentRegistry: (process.env.AGENT_REGISTRY_ADDRESS || "0x") as Address,

  // Is the payment token a MockERC20 with open mint()?
  isMockToken: process.env.IS_MOCK_TOKEN === "true",

  // Treasury wallet (funds players, NOT an HD-derived wallet)
  treasuryKey: (process.env.TREASURY_PRIVATE_KEY || "") as `0x${string}`,

  // Cold wallet for sweeping winnings
  coldWallet: (process.env.COLD_WALLET_ADDRESS || "") as Address,

  // Seed encryption password (set via env, never stored in plaintext)
  seedPassword: process.env.SEED_PASSWORD || "",

  // Alerts — Beaniebot push API
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "https://beanie.cryptoday.live/api/alerts/push",
  alertApiKey: process.env.ALERT_API_KEY || "",

  // Thresholds
  lowBalanceThreshold: process.env.LOW_BALANCE_WEI || "500000000000000000", // $0.50
  highBalanceThreshold: process.env.HIGH_BALANCE_WEI || "10000000000000000000", // $10
} as const;
