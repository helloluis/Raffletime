import { type Address } from "viem";
import { config } from "./config.js";
import {
  advanceRaffle,
  createHouseRaffle,
  getActiveRaffles,
  getRaffleInfo,
  RaffleState,
} from "./raffle-lifecycle.js";
import { getAgentAddress } from "./chain.js";
import {
  saveRaffleMeta,
  getRaffleMeta,
  nextHouseRaffleName,
  randomCoverImage,
} from "./raffle-store.js";

// Track the current house raffle
let currentVault: Address | null = null;

// Guard against overlapping ticks
let tickInProgress = false;

/**
 * On startup, scan for any existing active raffle created by this agent.
 * Prevents orphaned raffles and duplicate creation after restart.
 */
export async function recoverExistingRaffle(): Promise<void> {
  try {
    const agentAddress = getAgentAddress();
    const activeRaffles = await getActiveRaffles();

    for (const vaultAddr of activeRaffles) {
      const info = await getRaffleInfo(vaultAddr as Address);
      // Check if this raffle's vault has our agent as creator
      // We read creator from the vault
      const { publicClient } = await import("./chain.js");
      const { RaffleVaultAbi } = await import("./abis.js");
      const creator = (await publicClient.readContract({
        address: vaultAddr as Address,
        abi: RaffleVaultAbi,
        functionName: "creator",
      })) as Address;

      if (creator.toLowerCase() === agentAddress.toLowerCase()) {
        // Found our active raffle — resume tracking it
        const state = info.state;
        if (
          state !== RaffleState.SETTLED &&
          state !== RaffleState.INVALID
        ) {
          currentVault = vaultAddr as Address;
          console.log(
            `[scheduler] Recovered existing raffle: ${currentVault} (state=${state})`
          );
          return;
        }
      }
    }

    console.log("[scheduler] No existing active raffle found, will create new one");
  } catch (error) {
    console.error("[scheduler] Recovery scan failed:", error);
  }
}

/**
 * The main scheduler loop. Runs on a fixed interval:
 * 1. If no active house raffle exists, create one
 * 2. Advance existing raffles through their lifecycle
 * 3. After settlement, schedule the next raffle
 */
export async function runSchedulerTick(
  beneficiaries: Address[]
): Promise<void> {
  // Prevent overlapping ticks
  if (tickInProgress) {
    console.log("[scheduler] Previous tick still running, skipping");
    return;
  }

  tickInProgress = true;
  try {
    // Check if we have an active raffle
    if (currentVault) {
      const state = await advanceRaffle(currentVault);

      // If settled or invalid, clear current vault so next tick creates a new one
      if (state === RaffleState.SETTLED || state === RaffleState.INVALID) {
        console.log(
          "[scheduler] Raffle completed:",
          currentVault,
          "state:",
          RaffleState[state]
        );
        currentVault = null;
      }
      return;
    }

    // No active raffle — create a new one
    if (beneficiaries.length === 0) {
      console.log(
        "[scheduler] No beneficiaries configured, skipping raffle creation"
      );
      return;
    }

    const raffleName = nextHouseRaffleName();
    console.log(`[scheduler] Creating new house raffle: "${raffleName}"...`);
    currentVault = await createHouseRaffle(beneficiaries, raffleName);

    // Save metadata for this raffle
    saveRaffleMeta({
      vault: currentVault,
      name: raffleName,
      description: config.raffle.description,
      type: "house",
      coverImage: randomCoverImage(),
      creator: getAgentAddress(),
      createdAt: new Date().toISOString(),
    });

    console.log("[scheduler] House raffle active:", currentVault);
  } catch (error) {
    console.error("[scheduler] Error:", error);
  } finally {
    tickInProgress = false;
  }
}

/**
 * Start the scheduler loop
 */
export async function startScheduler(
  beneficiaries: Address[]
): Promise<NodeJS.Timeout> {
  console.log(
    `[scheduler] Starting with ${config.pollIntervalMs}ms poll interval`
  );

  // Recover any in-progress raffle from a previous run
  await recoverExistingRaffle();

  // Run first tick immediately
  await runSchedulerTick(beneficiaries);

  // Then poll on interval
  return setInterval(() => runSchedulerTick(beneficiaries), config.pollIntervalMs);
}

/**
 * Get the current active vault address (for API)
 */
export function getCurrentVault(): Address | null {
  return currentVault;
}
