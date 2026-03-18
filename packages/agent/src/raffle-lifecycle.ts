import { type Address, formatEther, parseEventLogs } from "viem";
import { publicClient, getWalletClient, getAgentAddress } from "./chain.js";
import {
  RaffleFactoryAbi,
  RaffleVaultAbi,
  RaffleRegistryAbi,
  AgentRegistryAbi,
  ERC20Abi,
  MockVRFDispatcherAbi,
} from "./abis.js";
import { config } from "./config.js";
import * as db from "./db.js";
import { setServerPhase, getServerPhase } from "./scheduler.js";
import { broadcast } from "./ws-hub.js";
import { formatUsd6 } from "./html.js";

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

    // House players have URIs like raffletime.io/agents/arabica.json (not player-*)
    const isHouse = uri.includes("raffletime.io") && !uri.includes("/player-");

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

  const existingByAddr = new Map<string, number>();
  for (const e of existingEntries) {
    existingByAddr.set(e.agent, e.tickets || 1);
  }

  const GetParticipantsAbi = [
    { name: "getParticipants", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
  ] as const;

  // getParticipants() returns all ticket entries (with duplicates per user)
  const allEntries = (await publicClient.readContract({
    address: vault, abi: GetParticipantsAbi, functionName: "getParticipants",
  })) as string[];

  const seen = new Map<string, number>();
  for (const addr of allEntries) {
    seen.set(addr.toLowerCase(), (seen.get(addr.toLowerCase()) || 0) + 1);
  }

  // Upsert: add new participants and update ticket counts for existing ones
  for (const [addr, tickets] of seen.entries()) {
    const existing = existingByAddr.get(addr);
    if (existing === undefined) {
      // New participant
      await resolveAgentName(addr as Address);
      await db.recordEntry(vault, addr, tickets);
    } else if (existing < tickets) {
      // Existing participant bought more tickets
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

export const stateNames: Record<number, string> = {
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
  console.log("[lifecycle] Registering agent on-chain with bond:", bondAmount.toString());

  // Approve bond tokens (may be a different token from the raffle payment token)
  const approveTx = await writeContract({
    address: config.contracts.bondToken,
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
      `Insufficient balance: have $${(Number(balance) / 1e6).toFixed(2)}, need $${(Number(deposit) / 1e6).toFixed(2)} for deposit`
    );
  }

  console.log("[lifecycle] Approving creation deposit: $" + (Number(deposit) / 1e6).toFixed(2));
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
    ticketPriceUsd6: config.raffle.ticketPriceUsd6,
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
      ticketPrice: (Number(config.raffle.ticketPriceUsd6) / 1e6).toFixed(2),
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

/** Request draw and auto-fulfill if MOCK_VRF_DISPATCHER_ADDRESS is set (testnet only).
 *  With real Chainlink VRF, fulfillment is automatic via callback — no follow-up needed.
 *  Returns { requestId, drawTx } for storage. */
export async function requestDraw(vault: Address): Promise<{ requestId: string | null; drawTx: string }> {
  console.log("[lifecycle] Requesting draw:", vault);
  const hash = await writeContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "requestDraw",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Draw requested:", hash);

  // Parse DrawRequested event to capture VRF requestId
  let requestId: bigint | null = null;
  try {
    const logs = parseEventLogs({ abi: RaffleVaultAbi, logs: receipt.logs, eventName: "DrawRequested" });
    if (logs.length > 0) {
      requestId = (logs[0] as any).args.requestId as bigint;
      console.log(`[lifecycle] VRF requestId: ${requestId}`);
    }
  } catch {}

  // Testnet only: auto-fulfill via MockVRFDispatcher
  const mockAddr = process.env.MOCK_VRF_DISPATCHER_ADDRESS as Address | undefined;
  if (mockAddr && requestId !== null) {
    try {
      console.log(`[lifecycle] Auto-fulfilling mock VRF requestId=${requestId}...`);
      const fulfillHash = await writeContract({
        address: mockAddr,
        abi: MockVRFDispatcherAbi,
        functionName: "fulfillRequest",
        args: [requestId],
      });
      await publicClient.waitForTransactionReceipt({ hash: fulfillHash });
      console.log("[lifecycle] Mock VRF fulfilled:", fulfillHash);
    } catch (e) {
      console.log("[lifecycle] Mock VRF auto-fulfill failed:", String(e).slice(0, 120));
    }
  }

  return { requestId: requestId !== null ? requestId.toString() : null, drawTx: hash };
}

/**
 * Query vault logs for DrawCompleted event to get the VRF seed and fulfillment tx.
 * Called once when we detect PAYOUT state — Chainlink has already fulfilled by this point.
 */
export async function getVrfProof(vault: Address): Promise<{ seed: string; fulfillmentTx: string } | null> {
  try {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > 500n ? latest - 500n : 0n; // ~17 min lookback on Base Sepolia
    const logs = await publicClient.getLogs({
      address: vault,
      event: {
        name: "DrawCompleted",
        type: "event",
        inputs: [{ name: "seed", type: "uint256", indexed: false }],
      },
      fromBlock,
      toBlock: "latest",
    });
    if (logs.length === 0) return null;
    const log = logs[0];
    const seed = (log as any).args.seed as bigint;
    return { seed: seed.toString(), fulfillmentTx: log.transactionHash };
  } catch (e) {
    console.log("[lifecycle] getVrfProof failed:", String(e).slice(0, 120));
    return null;
  }
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
      pool: (Number(info.totalPool) / 1e6).toFixed(2),
      participants: Number(info.participantCount),
      closesAt: new Date(Number(info.closesAt) * 1000),
    });
    // Sync participant identities (only new ones — resolved names are cached in DB)
    if (info.participantCount > 0n && info.state === RaffleState.OPEN) {
      await syncParticipants(vault, info.participantCount);
    }
  } catch {}

  const pool = (Number(info.totalPool) / 1e6).toFixed(2);
  const participants = info.participantCount.toString();
  const closesAtMs = Number(info.closesAt) * 1000;
  console.log(
    `[lifecycle] ${vault.slice(0, 10)}... state=${stateNames[info.state]} pool=${pool} participants=${participants}`
  );

  // Broadcast tick to all WebSocket clients
  const meta = (await import("./raffle-store.js")).getRaffleMeta(vault);
  broadcast({
    type: "tick",
    vault,
    pool,
    participants,
    closesAt: closesAtMs,
    name: meta?.name || "House Raffle",
    ticketPrice: formatUsd6(config.raffle.ticketPriceUsd6),
  });

  switch (info.state) {
    case RaffleState.OPEN: {
      // Only set OPEN if we're not in a post-raffle display phase
      const currentPhase = getServerPhase().phase;
      const postRafflePhases = ["RESULT", "DISTRIB", "INVALID", "REFUND"];
      if (!postRafflePhases.includes(currentPhase)) {
        setServerPhase("OPEN");
      }
      if (now >= info.closesAt) {
        await new Promise((r) => setTimeout(r, 5000)); // let block.timestamp catch up
        await closeRaffle(vault);
        setServerPhase("DRAWING");
        return RaffleState.CLOSED;
      }
      break;
    }

    case RaffleState.CLOSED: {
      const minParticipants = Number(config.raffle.minUniqueParticipants);
      if (info.participantCount < minParticipants) {
        setServerPhase("INVALID");
        console.log(
          `[lifecycle] Raffle closed with only ${info.participantCount}/${minParticipants} participants — going to INVALID`
        );
      } else {
        setServerPhase("DRAWING");
      }
      console.log(
        `[lifecycle] Raffle closed with ${info.participantCount} participants. Requesting draw...`
      );
      const { requestId, drawTx } = await requestDraw(vault);
      try { await db.upsertRaffle({ vault, vrfRequestId: requestId ?? undefined, drawTx: drawTx ?? undefined }); } catch {}
      return await getVaultState(vault);
    }

    case RaffleState.DRAWING:
      // Chainlink VRF v2.5 push model: VRFDispatcher.fulfillRandomWords() calls
      // vault.receiveRandomness() which auto-advances to PAYOUT. Nothing to do here.
      // On testnet, auto-fulfill already happens inline in requestDraw() above.
      console.log("[lifecycle] Waiting for Chainlink VRF callback...");
      break;

    case RaffleState.PAYOUT: {
      // Capture VRF proof before distributing (Chainlink has already fulfilled by now)
      const vrfProof = await getVrfProof(vault);
      const vrfRequestId = (await db.getRaffle(vault))?.vrf_request_id || null;
      await distributePrizes(vault);
      // Sync all participant identities to DB, then record result
      try {
        await syncParticipants(vault, info.participantCount);
        const winners = (await publicClient.readContract({
          address: vault, abi: RaffleVaultAbi, functionName: "getWinners",
        })) as string[];
        if (winners.length > 0) {
          const winnerName = await resolveAgentName(winners[0] as Address);
          const vrf = vrfProof ? { requestId: vrfRequestId || "", seed: vrfProof.seed, fulfillmentTx: vrfProof.fulfillmentTx } : undefined;
          await db.recordResult(vault, winners[0], winnerName, (Number(info.totalPool) / 1e6).toFixed(2), vrf);
          if (vrfProof) console.log(`[lifecycle] VRF seed: ${vrfProof.seed}, fulfillment: ${vrfProof.fulfillmentTx}`);
          console.log(`[lifecycle] Winner: ${winnerName || winners[0].slice(0,10)} won $${(Number(info.totalPool) / 1e6).toFixed(2)}`);
          setServerPhase("RESULT", { address: winners[0], name: winnerName, prize: (Number(info.totalPool) / 1e6).toFixed(2) });

          // Auto-advance: RESULT → DISTRIB → RESET
          setTimeout(() => setServerPhase("DISTRIB"), 15000);
          setTimeout(() => setServerPhase("RESET"), 25000);
        }
        await db.upsertRaffle({ vault, state: "SETTLED", settledAt: new Date() });

        // Broadcast settled event for history table
        const meta = (await import("./raffle-store.js")).getRaffleMeta(vault);
        const dt = new Date();
        const ended = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
        broadcast({
          type: "settled",
          vault,
          name: meta?.name || "House Raffle",
          pool: pool,
          participants: participants,
          winner: winners.length > 0 ? winners[0] : null,
          winnerName: winners.length > 0 ? (await resolveAgentName(winners[0] as Address)) : null,
          prize: pool,
          state: "SETTLED",
          ended,
        });
      } catch (e) {
        console.log("[lifecycle] DB sync error:", String(e).slice(0, 100));
      }
      // Reclaim ARO deposit from factory
      try { await claimDeposit(vault); } catch {}
      return RaffleState.SETTLED;
    }

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
      setTimeout(() => setServerPhase("RESET"), 25000);
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
      // Reclaim ARO deposit from factory (50% refunded on invalid)
      try { await claimDeposit(vault); } catch {}
      break;
  }

  return info.state;
}
