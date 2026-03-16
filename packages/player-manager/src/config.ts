import "dotenv/config";
import { type Address } from "viem";

export const config = {
  chainId: parseInt(process.env.CHAIN_ID || "84532"),         // Base Sepolia
  rpcUrl: process.env.RPC_URL || "https://sepolia.base.org",

  // Contracts
  paymentToken: (process.env.PAYMENT_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address,
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

  // Thresholds in USDC 6-decimal units
  lowBalanceThreshold: process.env.LOW_BALANCE_THRESHOLD || "500000",    // $0.50 USDC
  highBalanceThreshold: process.env.HIGH_BALANCE_THRESHOLD || "10000000", // $10.00 USDC
} as const;
