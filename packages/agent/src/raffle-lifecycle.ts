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
        functionName: "getParticipantCount",
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

  // Create raffle
  console.log("[lifecycle] Creating house raffle...");
  const params = {
    name: name || config.raffle.name,
    description: config.raffle.description,
    ticketPrice: config.raffle.ticketPrice,
    maxEntriesPerUser: config.raffle.maxEntriesPerUser,
    numWinners: config.raffle.numWinners,
    winnerShareBps: config.raffle.winnerShareBps,
    beneficiaryShareBps: config.raffle.beneficiaryShareBps,
    beneficiaryOptions: beneficiaries,
    duration: config.raffle.duration,
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

export async function completeDraw(vault: Address): Promise<void> {
  console.log("[lifecycle] Completing draw (fetching randomness):", vault);
  const hash = await writeContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "completeDraw",
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[lifecycle] Draw completed:", hash);
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

  console.log(
    `[lifecycle] ${vault.slice(0, 10)}... state=${stateNames[info.state]} pool=${formatEther(info.totalPool)} participants=${info.participantCount}`
  );

  switch (info.state) {
    case RaffleState.OPEN:
      if (now >= info.closesAt) {
        await closeRaffle(vault);
        return RaffleState.CLOSED;
      }
      break;

    case RaffleState.CLOSED:
      // Direct entry — no reveal phase needed. Request draw immediately.
      console.log(
        `[lifecycle] Raffle closed with ${info.participantCount} participants. Requesting draw...`
      );
      await requestDraw(vault);
      return await getVaultState(vault);

    case RaffleState.DRAWING: {
      // Two-step: check if randomness oracle has fulfilled, then complete the draw
      const ready = await isRandomnessReady(vault);
      if (ready) {
        await completeDraw(vault);
        return await getVaultState(vault);
      }
      console.log("[lifecycle] Waiting for randomness oracle...");
      break;
    }

    case RaffleState.PAYOUT:
      await distributePrizes(vault);
      return RaffleState.SETTLED;

    case RaffleState.SETTLED:
      try {
        await claimDeposit(vault);
      } catch {
        // Already claimed or not creator
      }
      break;

    case RaffleState.INVALID:
      // Nothing to do — scheduler will detect this and create next raffle
      break;
  }

  return info.state;
}
