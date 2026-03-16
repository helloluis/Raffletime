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
import { base, baseSepolia } from "viem/chains";
import { config } from "./config.js";

const chains: Record<number, Chain> = {
  8453: base,
  84532: baseSepolia,
};

const chain = chains[config.chainId] ?? baseSepolia;

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
