import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
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

// Singleton wallet client — nonceManager requires the same instance for sequential nonce tracking
let _walletClient: WalletClient | null = null;

export function getWalletClient(): WalletClient {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }
  if (!_walletClient) {
    const account = privateKeyToAccount(config.privateKey as `0x${string}`, { nonceManager });
    _walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    });
  }
  return _walletClient;
}

/**
 * Wait for a TX receipt by polling. More reliable than viem's built-in
 * waitForTransactionReceipt which hangs on some RPC providers.
 */
export async function waitForTx(hash: `0x${string}`, timeoutMs = 60_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      if (receipt) return receipt;
    } catch {
      // receipt not available yet
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  // Last check before throwing
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    if (receipt) return receipt;
  } catch {}
  throw new Error(`TX receipt timeout after ${timeoutMs / 1000}s: ${hash.slice(0, 14)}...`);
}

export function getAgentAddress(): Address {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }
  return privateKeyToAccount(config.privateKey as `0x${string}`).address;
}
