import { http, type Chain } from "wagmi";
import { celo, celoAlfajores } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

const celoSepolia: Chain = {
  id: 11142220,
  name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://forno.celo-sepolia.celo-testnet.org"] },
  },
  blockExplorers: {
    default: { name: "CeloScan", url: "https://sepolia.celoscan.io" },
  },
  testnet: true,
};

const chains: Record<string, Chain> = {
  mainnet: celo,
  alfajores: celoAlfajores,
  sepolia: celoSepolia,
};

const activeChain = chains[import.meta.env.VITE_CHAIN || "sepolia"] || celoSepolia;

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
  agentRegistry: (import.meta.env.VITE_AGENT_REGISTRY_ADDRESS ||
    "0x") as `0x${string}`,
  paymentToken: (import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS ||
    "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1") as `0x${string}`,
} as const;
