import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoAlfajores, celo } from "viem/chains";
import { defineChain } from "viem";
import { config } from "./config.js";

const celoSepolia = defineChain({
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
});

const chains: Record<number, Chain> = {
  11142220: celoSepolia,
  44787: celoAlfajores,
  42220: celo,
};

const chain = chains[config.chainId] ?? celoSepolia;

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

export function getWalletClient(): WalletClient {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
}

export function getAgentAddress(): Address {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }
  return privateKeyToAccount(config.privateKey as `0x${string}`).address;
}
