import { type Address } from "viem";
import { config } from "./config.js";
import {
  advanceRaffle,
  closeRaffle,
  createHouseRaffle,
  getActiveRaffles,
  getRaffleInfo,
  RaffleState,
  stateNames,
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

// Server-side phase tracking for the post-raffle timeline
export type ServerPhase = "OPEN" | "DRAWING" | "RESULT" | "DISTRIB" | "RESET" | "INVALID" | "REFUND";
let currentPhase: ServerPhase = "OPEN";
let phaseChangedAt: number = Date.now();
let lastWinner: { address: string; name: string | null; prize: string } | null = null;

export function getServerPhase(): { phase: ServerPhase; changedAt: number; winner: typeof lastWinner } {
  return { phase: currentPhase, changedAt: phaseChangedAt, winner: lastWinner };
}

export function setServerPhase(phase: ServerPhase, winner?: typeof lastWinner) {
  if (phase !== currentPhase) {
    currentPhase = phase;
    phaseChangedAt = Date.now();
    if (winner) lastWinner = winner;
    console.log(`[scheduler] Phase → ${phase}`);
  }
}

// Guard against overlapping ticks
let tickInProgress = false;

// Consecutive failure tracking for retry/backoff/alert
let consecutiveFailures = 0;
let backoffUntil = 0; // epoch ms — skip ticks until this time

async function sendAlert(message: string): Promise<void> {
  if (!config.alertApiKey) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.alertApiKey}` },
      body: JSON.stringify({ message, source: "raffletime-agent" }),
    });
  } catch {}
}

/**
 * Run fn with retry: 1 attempt/second up to maxAttempts, then exponential backoff.
 * Alerts the owner after maxAttempts failures.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (consecutiveFailures > 0) {
        console.log(`[scheduler] ${label} recovered after ${consecutiveFailures} failure(s)`);
        consecutiveFailures = 0;
        backoffUntil = 0;
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] ${label} attempt ${attempt}/${maxAttempts} failed: ${msg.slice(0, 120)}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000)); // 1s between retries
      }
    }
  }

  // All attempts exhausted
  consecutiveFailures++;
  const backoffSecs = Math.min(60 * 16, Math.pow(2, consecutiveFailures) * 15); // 15s, 30s, 60s … 16min cap
  backoffUntil = Date.now() + backoffSecs * 1000;
  const alertMsg = `⚠️ RaffleTime agent: **${label}** failed ${maxAttempts}x in a row (${consecutiveFailures} consecutive). Backing off ${backoffSecs}s.`;
  console.error(`[scheduler] ${alertMsg}`);
  await sendAlert(alertMsg);

  throw new Error(`${label} failed after ${maxAttempts} attempts`);
}

/**
 * On startup, scan for any existing active raffle created by this agent.
 * Prevents orphaned raffles and duplicate creation after restart.
 */
export async function recoverExistingRaffle(): Promise<void> {
  try {
    const agentAddress = getAgentAddress();
    const { publicClient } = await import("./chain.js");
    const { RaffleVaultAbi } = await import("./abis.js");
    const db = await import("./db.js");

    // First: check DB for vaults in mid-lifecycle states (CLOSED/DRAWING/PAYOUT)
    // These fall off the registry's active list but still need attention
    try {
      const inflight = await db.query(
        `SELECT vault FROM raffles WHERE state IN ('CLOSED','DRAWING','PAYOUT') AND created_at > now() - interval '2 days'
         UNION
         SELECT vault FROM raffles WHERE state = 'OPEN' AND closes_at < now() - interval '5 minutes' AND created_at > now() - interval '2 days'
         ORDER BY created_at DESC LIMIT 5`
      );
      for (const row of inflight) {
        const vaultAddr = row.vault as Address;
        const info = await getRaffleInfo(vaultAddr);
        if (info.state !== RaffleState.SETTLED && info.state !== RaffleState.INVALID) {
          const creator = (await publicClient.readContract({
            address: vaultAddr,
            abi: RaffleVaultAbi,
            functionName: "creator",
          })) as Address;
          if (creator.toLowerCase() === agentAddress.toLowerCase()) {
            currentVault = vaultAddr;
            console.log(`[scheduler] Recovered in-flight raffle: ${currentVault} (state=${info.state})`);
            return;
          }
        }
      }
    } catch {}

    // Second: check on-chain registry for OPEN vaults
    const activeRaffles = await getActiveRaffles();

    for (const vaultAddr of activeRaffles) {
      const info = await getRaffleInfo(vaultAddr as Address);
      const creator = (await publicClient.readContract({
        address: vaultAddr as Address,
        abi: RaffleVaultAbi,
        functionName: "creator",
      })) as Address;

      if (creator.toLowerCase() === agentAddress.toLowerCase()) {
        const state = info.state;
        if (state !== RaffleState.SETTLED && state !== RaffleState.INVALID) {
          const nowSecs = BigInt(Math.floor(Date.now() / 1000));
          const maxClosesAt = nowSecs + 90000n; // 25 hours
          if (state === RaffleState.OPEN && info.closesAt > maxClosesAt) {
            console.log(`[scheduler] Skipping vault with far-future closesAt (${info.closesAt}): ${vaultAddr}`);
            continue;
          }
          currentVault = vaultAddr as Address;
          console.log(`[scheduler] Recovered existing raffle: ${currentVault} (state=${state})`);
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

  // Skip tick during backoff window
  if (Date.now() < backoffUntil) {
    const secsLeft = Math.ceil((backoffUntil - Date.now()) / 1000);
    console.log(`[scheduler] In backoff — skipping tick (${secsLeft}s remaining)`);
    tickInProgress = false;
    return;
  }

  tickInProgress = true;
  try {
    if (currentVault) {
      const state = await withRetry(
        () => advanceRaffle(currentVault!),
        `advanceRaffle(${currentVault.slice(0, 10)}…)`
      );

      if (state === RaffleState.SETTLED || state === RaffleState.INVALID) {
        console.log("[scheduler] Raffle completed:", currentVault, "state:", RaffleState[state]);
        currentVault = null;
      }
      return;
    }

    // No active raffle — create a new one
    const raffleName = nextHouseRaffleName();
    console.log(`[scheduler] Creating new house raffle: "${raffleName}"...`);
    currentVault = await withRetry(
      () => createHouseRaffle(beneficiaries, raffleName),
      "createHouseRaffle"
    );

    saveRaffleMeta({
      vault: currentVault,
      name: raffleName,
      description: config.raffle.description,
      type: "house",
      coverImage: randomCoverImage(),
      creator: getAgentAddress(),
      createdAt: new Date().toISOString(),
    });

    setServerPhase("OPEN");
    console.log("[scheduler] House raffle active:", currentVault);
  } catch (error) {
    // withRetry already logged and alerted — nothing more to do this tick
  } finally {
    tickInProgress = false;
  }
}

/**
 * Periodic health check: find OPEN vaults that are past their close time and close them.
 * Catches orphaned raffles that the scheduler missed (e.g. after a crash/restart).
 * Skips the current active vault — the scheduler handles that one.
 */
async function orphanCheck(): Promise<void> {
  try {
    const db = await import("./db.js");
    const rows = await db.query(
      `SELECT vault FROM raffles
       WHERE state = 'OPEN' AND closes_at < now() - interval '5 minutes'
       AND created_at > now() - interval '2 days'
       ORDER BY closes_at ASC`
    );

    for (const row of rows) {
      const vault = row.vault as Address;
      if (vault === currentVault) continue; // scheduler owns this one

      const info = await getRaffleInfo(vault);
      if (info.state !== RaffleState.OPEN) {
        // Already advanced on-chain — sync DB state
        await db.upsertRaffle({ vault, state: stateNames[info.state] || "UNKNOWN" });
        continue;
      }

      console.log(`[scheduler] Orphan check: closing stuck vault ${vault}`);
      try {
        await closeRaffle(vault);
        console.log(`[scheduler] Orphan closed: ${vault}`);
      } catch (e) {
        console.error(`[scheduler] Orphan close failed for ${vault}:`, String(e).slice(0, 120));
      }
    }
  } catch (e) {
    console.error("[scheduler] Orphan check error:", String(e).slice(0, 120));
  }
}

/**
 * Schedule orphanCheck at every 5-minute mark of the clock (:00, :05, :10 ...)
 */
function startOrphanCheckCron(): void {
  const scheduleNext = () => {
    const now = Date.now();
    const msUntilNext5Min = (5 * 60 * 1000) - (now % (5 * 60 * 1000));
    setTimeout(async () => {
      await orphanCheck();
      scheduleNext();
    }, msUntilNext5Min);
  };
  scheduleNext();
  console.log("[scheduler] Orphan check cron started (runs at every 5-minute mark)");
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

  // Start periodic orphan check
  startOrphanCheckCron();

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
