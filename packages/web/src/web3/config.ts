import { http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

const chains = { mainnet: base, sepolia: baseSepolia };
const activeChain = chains[import.meta.env.VITE_CHAIN as keyof typeof chains] ?? baseSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: "RaffleTime",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [activeChain],
  transports: {
    [activeChain.id]: http(),
  },
});

// Contract addresses — set via env or defaults
export const contracts = {
  factory: (import.meta.env.VITE_FACTORY_ADDRESS || "0x") as `0x${string}`,
  registry: (import.meta.env.VITE_REGISTRY_ADDRESS || "0x") as `0x${string}`,
  agentRegistry: (import.meta.env.VITE_AGENT_REGISTRY_ADDRESS || "0x") as `0x${string}`,
  paymentToken: (import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS ||
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`, // USDC on Base Sepolia
} as const;
