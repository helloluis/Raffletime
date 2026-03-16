import { type Address, formatEther, parseEventLogs } from "viem";
import { publicClient, getWalletClient, getAgentAddress } from "./chain.js";
import {
  RaffleFactoryAbi,
  RaffleVaultAbi,
  RaffleRegistryAbi,
  AgentRegistryAbi,
  ERC20Abi,
} from "./abis.js";
import { config } from "./config.js";
import * as db from "./db.js";
import { setServerPhase } from "./scheduler.js";

/** Resolve an address to an agent name via on-chain AgentRegistry + cache in DB.
 *  Refreshes on-chain data if DB entry is older than 4 hours. */
async function resolveAgentName(address: Address): Promise<string | null> {
  // Check DB first
  const cached = await db.getAgent(address);
  if (cached?.name) {
    const age = Date.now() - new Date(cached.updated_at).getTime();
    const REFRESH_MS = 4 * 60 * 60 * 1000; // 4 hours
    if (age < REFRESH_MS) return cached.name;
    // Stale — fall through to refresh from chain
  }

  // Look up on-chain
  try {
    const AgentLookupAbi = [
      { name: "getAgentIdByAddress", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
      { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
    ] as const;

    const agentId = (await publicClient.readContract({
      address: config.contracts.agentRegistry,
      abi: AgentLookupAbi,
      functionName: "getAgentIdByAddress",
      args: [address],
    })) as bigint;

    if (agentId === 0n) return null;

    const uri = (await publicClient.readContract({
      address: config.contracts.agentRegistry,
      abi: AgentLookupAbi,
      functionName: "tokenURI",
      args: [agentId],
    })) as string;

    let name: string | null = null;
    const nameMatch = uri.match(/\/agents\/([^/.]+)\.json/);
    if (nameMatch) {
      name = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).replace(/-/g, " ");
    }

    const isHouse = uri.includes("raffletime.io");

    // Write to DB for future lookups
    await db.upsertAgent({
      address,
      agentId: Number(agentId),
      name,
      uri,
      isHouse,
      registered: true,
    });

    return name;
  } catch {
    return null;
  }
}

/** Resolve all participants in a raffle and sync to DB.
 *  Skips participants already in DB for this raffle (incremental sync). */
async function syncParticipants(vault: Address, participantCount: bigint): Promise<void> {
  // Check how many entries we already have in DB for this raffle
  let existingEntries: any[] = [];
  try {
    existingEntries = await db.getEntriesForRaffle(vault);
  } catch {}

  const existingAddrs = new Set(existingEntries.map((e: any) => e.agent));
  const count = Number(participantCount);

  // If DB already has all participants, skip
  if (existingAddrs.size >= count && count > 0) return;

  const ParticipantsAbi = [
    { name: "participants", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  ] as const;

  const seen = new Map<string, number>();
  for (let i = 0; i < count && i < 100; i++) {
    try {
      const addr = (await publicClient.readContract({
        address: vault, abi: ParticipantsAbi, functionName: "participants", args: [BigInt(i)],
      })) as string;
      seen.set(addr.toLowerCase(), (seen.get(addr.toLowerCase()) || 0) + 1);
    } catch { break; }
  }

  // Only resolve new participants
  for (const [addr, tickets] of seen.entries()) {
    if (!existingAddrs.has(addr)) {
      await resolveAgentName(addr as Address);
      await db.recordEntry(vault, addr, tickets);
    }
  }
}

// Raffle states matching the Solidity enum
export enum RaffleState {
  UNINITIALIZED = 0,
  OPEN = 1,
  CLOSED = 2,
  DRAWING = 3,
  PAYOUT = 4,
  SETTLED = 5,
  INVALID = 6,
}

const stateNames: Record<number, string> = {
  0: "UNINITIALIZED",
  1: "OPEN",
  2: "CLOSED",
  3: "DRAWING",
  4: "PAYOUT",
  5: "SETTLED",
  6: "INVALID",
};

export interface RaffleInfo {
  address: Address;
  state: RaffleState;
  totalPool: bigint;
  participantCount: bigint;
  closesAt: bigint;
}

// Helper to write contract without viem's strict chain typing
async function writeContract(params: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}): Promise<`0x${string}`> {
  const wallet = getWalletClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await wallet.writeContract(params as any);
  return hash;
}

// ============ Read operations ============

export async function getVaultState(vault: Address): Promise<RaffleState> {
  const state = await publicClient.readContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "state",
  });
  return state as RaffleState;
}

export async function getRaffleInfo(vault: Address): Promise<RaffleInfo> {
  const [state, totalPool, participantCount, closesAt] =
    await Promise.all([
      publicClient.readContract({
        address: vault,
        abi: RaffleVaultAbi,
        functionName: "state",
      }),
      publicClient.readContract({
        address: vault,
        abi: RaffleVaultAbi,
        functionName: "totalPool",
      }),
      publicClient.readContract({
        address: vault,
        abi: RaffleVaultAbi,
        functionName: "uniqueParticipantCount",
      }),
      publicClient.readContract({
        address: vault,
        abi: RaffleVaultAbi,
        functionName: "closesAt",
      }),
    ]);

  return {
    address: vault,
    state: state as RaffleState,
    totalPool: totalPool as bigint,
    participantCount: participantCount as bigint,
    closesAt: closesAt as bigint,
  };
}

export async function getActiveRaffles(): Promise<Address[]> {
  const raffles = await publicClient.readContract({
    address: config.contracts.registry,
    abi: RaffleRegistryAbi,
    functionName: "getActiveRaffles",
  });
  return raffles as Address[];
}

/** Look up on-chain raffle name from the registry by scanning entries */
export async function getRaffleName(vault: Address): Promise<string | null> {
  try {
    const count = (await publicClient.readContract({
      address: config.contracts.registry,
      abi: RaffleRegistryAbi,
      functionName: "getRaffleCount",
    })) as bigint;

    for (let i = 0n; i < count; i++) {
      const entry = (await publicClient.readContract({
        address: config.contracts.registry,
        abi: RaffleRegistryAbi,
        functionName: "getRaffle",
        args: [i],
      })) as any;

      // viem may return as array [vault, creator, name, ...] or object
      const entryVault = entry.vault || entry[0];
      const entryName = entry.name || entry[2];

      if (String(entryVault).toLowerCase() === vault.toLowerCase()) {
        return entryName || null;
      }
    }
  } catch {
    // Registry read failed
  }
  return null;
}

export async function isAgentRegistered(): Promise<boolean> {
  const address = getAgentAddress();
  return (await publicClient.readContract({
    address: config.contracts.agentRegistry,
    abi: AgentRegistryAbi,
    functionName: "isRegistered",
    args: [address],
  })) as boolean;
}

export async function getAgentBalance(): Promise<bigint> {
  const address = getAgentAddress();
  return (await publicClient.readContract({
    address: config.contracts.paymentToken,
    abi: ERC20Abi,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
}

// ============ Write operations ============

export async function ensureAgentRegistered(): Promise<void> {
  const registered = await isAgentRegistered();
  if (registered) {
    console.log("[lifecycle] Agent already registered");
    return;
  }

  const bondAmount = config.bondAmount;
  console.log("[lifecycle] Registering agent on-chain with bond:", formatEther(bondAmount));

  // Approve bond tokens
  const approveTx = await writeContract({
    address: config.contracts.paymentToken,
    abi: ERC20Abi,
    functionName: "approve",
    args: [config.contracts.agentRegistry, bondAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Register with bond
  const hash = await writeContract({
    address: config.contracts.agentRegistry,
    abi: AgentRegistryAbi,
    functionName: "registerAgent",
    args: [config.agentURI, bondAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Agent registered:", hash);
}

export async function createHouseRaffle(
  beneficiaries: Address[],
  name?: string
): Promise<Address> {
  // Calculate dynamic deposit based on target pool size
  const deposit = (await publicClient.readContract({
    address: config.contracts.factory,
    abi: RaffleFactoryAbi,
    functionName: "calculateDeposit",
    args: [config.raffle.targetPoolSize],
  })) as bigint;

  // Check balance before attempting
  const balance = await getAgentBalance();
  if (balance < deposit) {
    throw new Error(
      `Insufficient balance: have $${formatEther(balance)}, need $${formatEther(deposit)} for deposit`
    );
  }

  console.log("[lifecycle] Approving creation deposit:", formatEther(deposit));
  const approveTx = await writeContract({
    address: config.contracts.paymentToken,
    abi: ERC20Abi,
    functionName: "approve",
    args: [config.contracts.factory, deposit],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Create raffle — duration aligns to the top of the next hour
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  const secsUntilNextHour = Math.floor((nextHour.getTime() - now.getTime()) / 1000);
  // Use clock-aligned duration, but fall back to config if somehow <= 60s
  const duration = secsUntilNextHour > 60 ? BigInt(secsUntilNextHour) : config.raffle.duration;

  console.log(`[lifecycle] Creating house raffle... closes in ${secsUntilNextHour}s (at top of hour)`);
  const params = {
    name: name || config.raffle.name,
    description: config.raffle.description,
    ticketPrice: config.raffle.ticketPrice,
    maxEntriesPerUser: config.raffle.maxEntriesPerUser,
    numWinners: config.raffle.numWinners,
    winnerShareBps: config.raffle.winnerShareBps,
    beneficiaryShareBps: config.raffle.beneficiaryShareBps,
    beneficiaryOptions: beneficiaries,
    duration,
    targetPoolSize: config.raffle.targetPoolSize,
    minUniqueParticipants: config.raffle.minUniqueParticipants,
    agentsOnly: config.raffle.agentsOnly,
  };

  const hash = await writeContract({
    address: config.contracts.factory,
    abi: RaffleFactoryAbi,
    functionName: "createRaffle",
    args: [params],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract vault address from RaffleCreated event logs (not index-based)
  const RaffleCreatedAbi = [
    {
      name: "RaffleCreated",
      type: "event" as const,
      inputs: [
        { name: "vault", type: "address", indexed: true },
        { name: "creator", type: "address", indexed: true },
        { name: "name", type: "string", indexed: false },
        { name: "deposit", type: "uint256", indexed: false },
      ],
    },
  ];

  const logs = parseEventLogs({
    abi: RaffleCreatedAbi,
    logs: receipt.logs,
  });

  if (logs.length === 0) {
    throw new Error("RaffleCreated event not found in transaction receipt");
  }

  const vault = (logs[0] as any).args.vault as Address;
  console.log("[lifecycle] House raffle created:", vault, "tx:", hash);

  // Write to DB
  try {
    await db.upsertRaffle({
      vault,
      name: name || config.raffle.name,
      type: "house",
      state: "OPEN",
      pool: "0",
      participants: 0,
      ticketPrice: formatEther(config.raffle.ticketPrice),
      closesAt: new Date(Date.now() + Number(duration) * 1000),
      creator: getAgentAddress(),
    });
  } catch {}

  return vault;
}

export async function closeRaffle(vault: Address): Promise<void> {
  console.log("[lifecycle] Closing raffle:", vault);
  const hash = await writeContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "closeRaffle",
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Raffle closed:", hash);
}

export async function requestDraw(vault: Address): Promise<void> {
  console.log("[lifecycle] Requesting draw:", vault);
  const wallet = getWalletClient();
  // requestDraw is payable — send CELO for the randomness oracle fee
  // MockRandomness fee is 0, real Witnet fee is small
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await wallet.writeContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "requestDraw",
    value: 100000000000000000n, // 0.1 CELO — overpay, excess is refunded
  } as any);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Draw requested:", hash);
}

export async function isRandomnessReady(vault: Address): Promise<boolean> {
  return (await publicClient.readContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "isRandomnessReady",
  })) as boolean;
}

export async function completeDraw(vault: Address): Promise<string> {
  console.log("[lifecycle] Completing draw (fetching randomness):", vault);
  const hash = await writeContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "completeDraw",
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Draw completed:", hash);
  return hash;
}

export async function distributePrizes(vault: Address): Promise<void> {
  console.log("[lifecycle] Distributing prizes:", vault);
  const hash = await writeContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "distributePrizes",
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Prizes distributed:", hash);
}

export async function claimDeposit(vault: Address): Promise<void> {
  console.log("[lifecycle] Claiming ARO deposit:", vault);
  const hash = await writeContract({
    address: config.contracts.factory,
    abi: RaffleFactoryAbi,
    functionName: "claimDeposit",
    args: [vault],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Deposit claimed:", hash);
}

// ============ Lifecycle state machine ============

/**
 * Advance a raffle through its lifecycle. Called on each poll tick.
 * Returns the new state after any transitions.
 */
export async function advanceRaffle(vault: Address): Promise<RaffleState> {
  const info = await getRaffleInfo(vault);
  const now = BigInt(Math.floor(Date.now() / 1000));

  // Sync raffle state + participants to DB
  try {
    await db.upsertRaffle({
      vault,
      state: stateNames[info.state] || "UNKNOWN",
      pool: formatEther(info.totalPool),
      participants: Number(info.participantCount),
      closesAt: new Date(Number(info.closesAt) * 1000),
    });
    // Sync participant identities (only new ones — resolved names are cached in DB)
    if (info.participantCount > 0n && info.state === RaffleState.OPEN) {
      await syncParticipants(vault, info.participantCount);
    }
  } catch {}

  console.log(
    `[lifecycle] ${vault.slice(0, 10)}... state=${stateNames[info.state]} pool=${formatEther(info.totalPool)} participants=${info.participantCount}`
  );

  switch (info.state) {
    case RaffleState.OPEN:
      setServerPhase("OPEN");
      if (now >= info.closesAt) {
        await closeRaffle(vault);
        setServerPhase("DRAWING");
        return RaffleState.CLOSED;
      }
      break;

    case RaffleState.CLOSED:
      setServerPhase("DRAWING");
      console.log(
        `[lifecycle] Raffle closed with ${info.participantCount} participants. Requesting draw...`
      );
      await requestDraw(vault);
      return await getVaultState(vault);

    case RaffleState.DRAWING: {
      // Two-step: check if randomness oracle has fulfilled, then complete the draw
      const ready = await isRandomnessReady(vault);
      if (ready) {
        const drawTx = await completeDraw(vault);
        try { await db.query("UPDATE raffles SET draw_tx = $1 WHERE vault = $2", [drawTx, vault.toLowerCase()]); } catch {}
        return await getVaultState(vault);
      }

      // Auto-fulfill MockRandomness on testnet if configured
      const mockAddr = process.env.MOCK_RANDOMNESS_ADDRESS;
      if (mockAddr) {
        try {
          const randBlock = (await publicClient.readContract({
            address: vault,
            abi: RaffleVaultAbi,
            functionName: "randomizeBlock",
          })) as bigint;

          if (randBlock > 0n) {
            console.log(`[lifecycle] Auto-fulfilling mock randomness for block ${randBlock}...`);
            const MockAbi = [{ name: "fulfillBlock", type: "function", stateMutability: "nonpayable", inputs: [{ name: "blockNumber", type: "uint256" }], outputs: [] }] as const;
            const fulfillHash = await writeContract({
              address: mockAddr as Address,
              abi: MockAbi,
              functionName: "fulfillBlock",
              args: [randBlock],
            });
            await publicClient.waitForTransactionReceipt({ hash: fulfillHash });
            console.log("[lifecycle] Mock randomness fulfilled:", fulfillHash);
            // Now complete the draw
            const drawTx = await completeDraw(vault);
            try { await db.query("UPDATE raffles SET draw_tx = $1 WHERE vault = $2", [drawTx, vault.toLowerCase()]); } catch {}
            return await getVaultState(vault);
          }
        } catch (e) {
          console.log("[lifecycle] Mock fulfill failed (may already be fulfilled):", String(e).slice(0, 100));
        }
      }

      console.log("[lifecycle] Waiting for randomness oracle...");
      break;
    }

    case RaffleState.PAYOUT:
      await distributePrizes(vault);
      // Sync all participant identities to DB, then record result
      try {
        await syncParticipants(vault, info.participantCount);
        const winners = (await publicClient.readContract({
          address: vault, abi: RaffleVaultAbi, functionName: "getWinners",
        })) as string[];
        if (winners.length > 0) {
          const winnerName = await resolveAgentName(winners[0] as Address);
          await db.recordResult(vault, winners[0], winnerName, formatEther(info.totalPool));
          console.log(`[lifecycle] Winner: ${winnerName || winners[0].slice(0,10)} won $${formatEther(info.totalPool)}`);
          setServerPhase("RESULT", { address: winners[0], name: winnerName, prize: formatEther(info.totalPool) });

          // Auto-advance: RESULT → DISTRIB → RESET
          setTimeout(() => setServerPhase("DISTRIB"), 30000);
          setTimeout(() => setServerPhase("RESET"), 45000);
        }
        await db.upsertRaffle({ vault, state: "SETTLED", settledAt: new Date() });
      } catch (e) {
        console.log("[lifecycle] DB sync error:", String(e).slice(0, 100));
      }
      return RaffleState.SETTLED;

    case RaffleState.SETTLED:
      try {
        await claimDeposit(vault);
      } catch {
        // Already claimed or not creator
      }
      break;

    case RaffleState.INVALID:
      setServerPhase("INVALID");
      setTimeout(() => setServerPhase("REFUND"), 10000);
      setTimeout(() => setServerPhase("RESET"), 90000);
      try { await db.upsertRaffle({ vault, state: "INVALID", settledAt: new Date() }); } catch {}
      // Auto-distribute refunds to all participants
      if (info.participantCount > 0n) {
        try {
          console.log("[lifecycle] Distributing refunds for invalid raffle...");
          const refundHash = await writeContract({
            address: vault,
            abi: RaffleVaultAbi,
            functionName: "distributeRefunds",
          });
          await publicClient.waitForTransactionReceipt({ hash: refundHash });
          console.log("[lifecycle] Refunds distributed:", refundHash);
        } catch (e) {
          console.log("[lifecycle] Refunds already distributed or no entries");
        }
      }
      break;
  }

  return info.state;
}
