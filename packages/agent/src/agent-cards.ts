/**
 * ERC-8004 agent card generation and wallet registry lookup.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET_REGISTRY_PATH = resolve(__dirname, "../data/test-wallets.json");

interface TestWallet {
  name: string;
  address: string;
  privateKey: string;
  registered: boolean;
  createdAt: string;
  totalSpent: string;
  totalWon: string;
  rafflesEntered: number;
  rafflesWon: number;
}

/** Look up a test agent by name slug and return an ERC-8004 agent card, or null */
export function loadWalletRegistry(nameSlug: string): object | null {
  if (!existsSync(WALLET_REGISTRY_PATH)) return null;

  try {
    const registry: Record<string, TestWallet> = JSON.parse(
      readFileSync(WALLET_REGISTRY_PATH, "utf-8")
    );

    // Find by name (case-insensitive, slug match)
    const slug = nameSlug.toLowerCase().replace(/\s+/g, "-");
    const wallet = Object.values(registry).find(
      (w) => w.name.toLowerCase().replace(/\s+/g, "-") === slug
    );

    if (!wallet) return null;

    return buildAgentCard({
      name: wallet.name,
      description: `Test raffle participant "${wallet.name}". Registered on RaffleTime.`,
      image: `/images/raffy.png`,
      endpoint: `https://raffletime.io`,
      address: wallet.address,
    });
  } catch {
    return null;
  }
}

/** Build an ERC-8004 compliant agent registration JSON */
export function buildAgentCard(opts: {
  name: string;
  description: string;
  image: string;
  endpoint: string;
  agentId?: number;
  address?: string;
}): object {
  const registryAddr = config.contracts.agentRegistry;
  const chainId = config.chainId;

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: opts.name,
    description: opts.description,
    image: opts.image,
    services: [
      {
        name: "web",
        endpoint: opts.endpoint,
      },
      {
        name: "raffle-entry",
        endpoint: `${opts.endpoint}/api/raffles`,
      },
    ],
    x402Support: true,
    active: true,
    registrations: [
      ...(opts.agentId
        ? [
            {
              agentId: opts.agentId,
              agentRegistry: `eip155:${chainId}:${registryAddr}`,
            },
          ]
        : []),
    ],
    supportedTrust: ["crypto-economic"],
    // Extended fields (not in spec but useful)
    ...(opts.address ? { wallet: opts.address } : {}),
    chain: {
      id: chainId,
      agentRegistry: registryAddr,
    },
  };
}
