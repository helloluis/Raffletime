import { type Address } from "viem";
import { config } from "./config.js";
import { broadcast } from "./ws-hub.js";
import {
  getActiveRaffles,
  getRaffleInfo,
  getVaultState,
  RaffleState,
  stateNames,
  // Fire-and-forget TX senders
  sendCloseRaffleTx,
  sendRequestDrawTx,
  sendMockVrfFulfillTx,
  sendDistributePrizesTx,
  sendClaimDepositTx,
  sendDistributeRefundsTx,
  sendApproveTx,
  sendCreateRaffleTx,
  // Read helpers
  getAllowance,
  getCreateDeposit,
  getFactoryVaultCount,
  detectNewVault,
  getAgentBalance,
  syncRaffleState,
  recordSettlement,
  // Blocking ops (used only for orphan check and one-time startup)
  closeRaffle,
} from "./raffle-lifecycle.js";
import { getAgentAddress } from "./chain.js";
import {
  saveRaffleMeta,
  nextHouseRaffleName,
  randomCoverImage,
} from "./raffle-store.js";

// ============ Pending TX tracker ============

interface PendingTx {
  hash: `0x${string}`;
  operation: string;
  sentAt: number;
  tickCount: number;
}
let pendingTx: PendingTx | null = null;

const PENDING_TX_TIMEOUT_TICKS = 8; // ~120s at 15s poll

// ============ Creation state machine ============

type CreationPhase = "IDLE" | "CREATING_APPROVE" | "CREATING_RAFFLE";
let creationPhase: CreationPhase = "IDLE";
let creationVaultCountBefore: bigint = 0n;
let creationRaffleName: string = "";

// ============ Track the current house raffle ============

let currentVault: Address | null = null;

// ============ Server-side phase tracking ============

export type ServerPhase = "OPEN" | "DRAWING" | "RESULT" | "DISTRIB" | "RESET" | "STNDBY" | "INVALID" | "REFUND";
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
    console.log(`[scheduler] Phase -> ${phase}`);
    broadcast({ type: "phase", phase, winner: lastWinner });
  }
}

// ============ Backoff / alerting ============

let consecutiveFailures = 0;
let backoffUntil = 0;

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

// ============ Guard ============

let tickInProgress = false;

// ============ Recovery (unchanged) ============

export async function recoverExistingRaffle(): Promise<void> {
  try {
    const agentAddress = getAgentAddress();
    const { publicClient } = await import("./chain.js");
    const { RaffleVaultAbi } = await import("./abis.js");
    const db = await import("./db.js");

    // First: check DB for vaults in mid-lifecycle states
    try {
      const inflight = await db.query(
        `SELECT vault FROM (
           SELECT vault, 1 AS priority, created_at FROM raffles
             WHERE state IN ('CLOSED','DRAWING','PAYOUT') AND created_at > now() - interval '2 days'
           UNION ALL
           SELECT vault, 2 AS priority, created_at FROM raffles
             WHERE state = 'OPEN' AND closes_at < now() - interval '5 minutes' AND created_at > now() - interval '2 days'
         ) t ORDER BY priority ASC, created_at DESC LIMIT 5`
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
          const maxClosesAt = nowSecs + 90000n;
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

// ============ Pending TX management ============

function setPendingTx(hash: `0x${string}`, operation: string): void {
  pendingTx = { hash, operation, sentAt: Date.now(), tickCount: 0 };
  console.log(`[scheduler] Pending TX set: ${operation} ${hash.slice(0, 14)}...`);
}

function clearPendingTx(reason: string): void {
  if (pendingTx) {
    console.log(`[scheduler] Pending TX cleared (${reason}): ${pendingTx.operation} ${pendingTx.hash.slice(0, 14)}...`);
  }
  pendingTx = null;
}

// ============ Main tick ============

export async function runSchedulerTick(
  beneficiaries: Address[]
): Promise<void> {
  if (tickInProgress) {
    console.log("[scheduler] Previous tick still running, skipping");
    return;
  }

  if (Date.now() < backoffUntil) {
    const secsLeft = Math.ceil((backoffUntil - Date.now()) / 1000);
    console.log(`[scheduler] In backoff -- skipping tick (${secsLeft}s remaining)`);
    return;
  }

  tickInProgress = true;
  try {
    // ---- Step 1: Check pending TX ----
    if (pendingTx) {
      pendingTx.tickCount++;
      console.log(`[scheduler] Pending TX "${pendingTx.operation}" tick ${pendingTx.tickCount}/${PENDING_TX_TIMEOUT_TICKS} hash=${pendingTx.hash.slice(0, 14)}...`);

      if (pendingTx.tickCount >= PENDING_TX_TIMEOUT_TICKS) {
        const alertMsg = `TX timeout: ${pendingTx.operation} ${pendingTx.hash.slice(0, 14)}... after ${pendingTx.tickCount} ticks`;
        console.error(`[scheduler] ${alertMsg}`);
        await sendAlert(alertMsg);
        clearPendingTx("timeout");
        // Fall through to let the state machine retry
      } else {
        // Check if the expected state change happened on-chain
        const confirmed = await checkPendingTxConfirmed();
        if (confirmed) {
          clearPendingTx("confirmed");
          // Reset failure tracking on success
          if (consecutiveFailures > 0) {
            console.log(`[scheduler] Recovered after ${consecutiveFailures} failure(s)`);
            consecutiveFailures = 0;
            backoffUntil = 0;
          }
          // Fall through to continue the state machine
        } else {
          // Still waiting -- return early
          return;
        }
      }
    }

    // ---- Step 2: Active vault exists -- advance it ----
    if (currentVault) {
      await advanceRaffle(currentVault);
      return;
    }

    // ---- Step 3: No active vault -- creation state machine ----
    await runCreationStateMachine(beneficiaries);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[scheduler] Tick error: ${msg.slice(0, 200)}`);
    consecutiveFailures++;
    const backoffSecs = Math.min(60, consecutiveFailures * 15);
    backoffUntil = Date.now() + backoffSecs * 1000;
    const alertMsg = `Scheduler tick failed (${consecutiveFailures} consecutive): ${msg.slice(0, 120)}`;
    console.error(`[scheduler] ${alertMsg} -- backing off ${backoffSecs}s`);
    await sendAlert(alertMsg);
  } finally {
    tickInProgress = false;
  }
}

// ============ Check if pending TX landed by reading on-chain state ============

async function checkPendingTxConfirmed(): Promise<boolean> {
  if (!pendingTx) return true;

  try {
    switch (pendingTx.operation) {
      case "approve": {
        // Check if allowance is now sufficient
        const allowance = await getAllowance(config.contracts.factory);
        const deposit = await getCreateDeposit();
        return allowance >= deposit;
      }
      case "createRaffle": {
        // Check if vault count increased
        const newVault = await detectNewVault(creationVaultCountBefore);
        if (newVault) {
          // Raffle created! Set it as active.
          currentVault = newVault;
          creationPhase = "IDLE";

          saveRaffleMeta({
            vault: newVault,
            name: creationRaffleName,
            description: config.raffle.description,
            type: "house",
            coverImage: randomCoverImage(),
            creator: getAgentAddress(),
            createdAt: new Date().toISOString(),
          });

          // Write to DB
          const db = await import("./db.js");
          try {
            await db.upsertRaffle({
              vault: newVault,
              name: creationRaffleName,
              type: "house",
              state: "OPEN",
              pool: "0",
              participants: 0,
              ticketPrice: (Number(config.raffle.ticketPriceUsd6) / 1e6).toFixed(2),
              closesAt: new Date(Date.now() + Number(config.raffle.duration) * 1000),
              creator: getAgentAddress(),
            });
          } catch {}

          setServerPhase("OPEN");
          console.log("[scheduler] House raffle active:", newVault);

          // Broadcast new raffle
          try {
            const info = await getRaffleInfo(newVault);
            const { formatUsd6 } = await import("./html.js");
            broadcast({
              type: "new_raffle",
              vault: newVault,
              name: creationRaffleName,
              closesAt: Number(info.closesAt) * 1000,
              ticketPrice: formatUsd6(config.raffle.ticketPriceUsd6),
              raffleType: "house",
            });
          } catch {}

          return true;
        }
        return false;
      }
      case "closeRaffle": {
        if (!currentVault) return true;
        const state = await getVaultState(currentVault);
        return state !== RaffleState.OPEN; // Moved past OPEN
      }
      case "requestDraw": {
        if (!currentVault) return true;
        const state = await getVaultState(currentVault);
        return state !== RaffleState.CLOSED; // Moved past CLOSED
      }
      case "mockVrfFulfill": {
        if (!currentVault) return true;
        const state = await getVaultState(currentVault);
        return state !== RaffleState.DRAWING; // Moved past DRAWING
      }
      case "distributePrizes": {
        if (!currentVault) return true;
        const state = await getVaultState(currentVault);
        return state !== RaffleState.PAYOUT; // Moved past PAYOUT
      }
      case "claimDeposit": {
        // claimDeposit is best-effort, always consider confirmed
        return true;
      }
      case "distributeRefunds": {
        if (!currentVault) return true;
        // Refunds are one-shot; check if vault moved to SETTLED or state unchanged
        // Since INVALID stays INVALID, just wait for TX timeout or assume success
        return true;
      }
      default:
        return true;
    }
  } catch (e) {
    console.log(`[scheduler] checkPendingTxConfirmed error: ${String(e).slice(0, 100)}`);
    return false;
  }
}

// ============ Fire-and-forget advanceRaffle ============

async function advanceRaffle(vault: Address): Promise<void> {
  const info = await getRaffleInfo(vault);
  const now = BigInt(Math.floor(Date.now() / 1000));

  // Sync DB + broadcast
  await syncRaffleState(vault, info);

  const pool = (Number(info.totalPool) / 1e6).toFixed(2);
  console.log(
    `[lifecycle] ${vault.slice(0, 10)}... state=${stateNames[info.state]} pool=${pool} participants=${info.participantCount}`
  );

  switch (info.state) {
    case RaffleState.OPEN: {
      // Only set OPEN if we're not in a post-raffle display phase
      const phase = getServerPhase().phase;
      const postRafflePhases: ServerPhase[] = ["RESULT", "DISTRIB", "RESET", "STNDBY", "INVALID", "REFUND"];
      if (!postRafflePhases.includes(phase)) {
        setServerPhase("OPEN");
      }
      if (now >= info.closesAt && !pendingTx) {
        // Small delay to let block.timestamp catch up
        await new Promise((r) => setTimeout(r, 5000));
        const hash = await sendCloseRaffleTx(vault);
        setPendingTx(hash, "closeRaffle");
        setServerPhase("DRAWING");
      }
      break;
    }

    case RaffleState.CLOSED: {
      const minParticipants = Number(config.raffle.minUniqueParticipants);
      if (info.participantCount < BigInt(minParticipants)) {
        setServerPhase("INVALID");
        console.log(
          `[lifecycle] Raffle closed with only ${info.participantCount}/${minParticipants} participants -- going to INVALID`
        );
      } else {
        setServerPhase("DRAWING");
      }
      if (!pendingTx) {
        console.log(
          `[lifecycle] Raffle closed with ${info.participantCount} participants. Requesting draw...`
        );
        const hash = await sendRequestDrawTx(vault);
        setPendingTx(hash, "requestDraw");
        try {
          const db = await import("./db.js");
          await db.upsertRaffle({ vault, drawTx: hash });
        } catch {}
      }
      break;
    }

    case RaffleState.DRAWING: {
      setServerPhase("DRAWING");
      // Testnet: auto-fulfill mock VRF if available
      const mockAddr = process.env.MOCK_VRF_DISPATCHER_ADDRESS;
      if (mockAddr && !pendingTx) {
        // Try to get requestId from DB or send fulfill blindly
        try {
          const db = await import("./db.js");
          const dbRaffle = await db.getRaffle(vault);
          if (dbRaffle?.vrf_request_id) {
            const hash = await sendMockVrfFulfillTx(BigInt(dbRaffle.vrf_request_id));
            if (hash) setPendingTx(hash, "mockVrfFulfill");
          }
        } catch {}
      }
      // On mainnet, Chainlink VRF pushes automatically. Nothing to do.
      console.log("[lifecycle] Waiting for VRF callback...");
      break;
    }

    case RaffleState.PAYOUT: {
      if (!pendingTx) {
        const hash = await sendDistributePrizesTx(vault);
        setPendingTx(hash, "distributePrizes");
      }
      break;
    }

    case RaffleState.SETTLED: {
      console.log("[scheduler] Raffle settled:", vault);
      // Record settlement (winner, VRF proof, DB, broadcast) -- reads only, no TX wait
      await recordSettlement(vault, info);
      // Fire-and-forget claimDeposit
      if (!pendingTx) {
        try {
          const hash = await sendClaimDepositTx(vault);
          setPendingTx(hash, "claimDeposit");
        } catch {}
      }
      // Clear the vault so next tick enters creation state machine
      currentVault = null;
      clearPendingTx("settled");
      break;
    }

    case RaffleState.INVALID: {
      setServerPhase("INVALID");
      setTimeout(() => setServerPhase("REFUND"), 10000);
      setTimeout(() => setServerPhase("RESET"), 25000);
      setTimeout(() => setServerPhase("STNDBY"), 35000);
      try {
        const db = await import("./db.js");
        await db.upsertRaffle({ vault, state: "INVALID", settledAt: new Date() });
      } catch {}
      // Auto-distribute refunds
      if (info.participantCount > 0n && !pendingTx) {
        try {
          const hash = await sendDistributeRefundsTx(vault);
          setPendingTx(hash, "distributeRefunds");
        } catch (e) {
          console.log("[lifecycle] Refunds already distributed or no entries");
        }
      }
      // Fire-and-forget claimDeposit (50% refunded on invalid)
      if (!pendingTx) {
        try {
          const hash = await sendClaimDepositTx(vault);
          setPendingTx(hash, "claimDeposit");
        } catch {}
      }
      // Clear vault
      currentVault = null;
      clearPendingTx("invalid-done");
      break;
    }
  }
}

// ============ Creation state machine ============

async function runCreationStateMachine(beneficiaries: Address[]): Promise<void> {
  switch (creationPhase) {
    case "IDLE": {
      // Try to recover existing raffle first
      await recoverExistingRaffle();
      if (currentVault) {
        console.log("[scheduler] Recovered raffle from timed-out TX:", currentVault);
        setServerPhase("OPEN");
        consecutiveFailures = 0;
        backoffUntil = 0;
        return;
      }

      // Check balance
      const deposit = await getCreateDeposit();
      const balance = await getAgentBalance();
      if (balance < deposit) {
        console.error(
          `[scheduler] Insufficient balance: have $${(Number(balance) / 1e6).toFixed(2)}, need $${(Number(deposit) / 1e6).toFixed(2)}`
        );
        return;
      }

      // Check if we already have sufficient allowance
      const allowance = await getAllowance(config.contracts.factory);
      if (allowance >= deposit) {
        // Skip approve, go straight to creating
        creationRaffleName = nextHouseRaffleName();
        creationVaultCountBefore = await getFactoryVaultCount();
        creationPhase = "CREATING_RAFFLE";
        console.log(`[scheduler] Allowance sufficient, sending createRaffle TX for "${creationRaffleName}"...`);
        const hash = await sendCreateRaffleTx(beneficiaries, creationRaffleName);
        setPendingTx(hash, "createRaffle");
        return;
      }

      // Send approve TX
      creationRaffleName = nextHouseRaffleName();
      console.log(`[scheduler] Creating new house raffle: "${creationRaffleName}"...`);
      console.log(`[scheduler] Approving deposit: $${(Number(deposit) / 1e6).toFixed(2)}`);
      const hash = await sendApproveTx(config.contracts.paymentToken, config.contracts.factory, deposit);
      setPendingTx(hash, "approve");
      creationPhase = "CREATING_APPROVE";
      break;
    }

    case "CREATING_APPROVE": {
      // Waiting for approve TX -- pendingTx should be set
      // If we get here with no pendingTx, it means approve was confirmed or timed out
      const deposit = await getCreateDeposit();
      const allowance = await getAllowance(config.contracts.factory);
      if (allowance >= deposit) {
        // Approve confirmed, send createRaffle
        creationVaultCountBefore = await getFactoryVaultCount();
        console.log(`[scheduler] Approve confirmed. Sending createRaffle TX...`);
        const hash = await sendCreateRaffleTx(beneficiaries, creationRaffleName);
        setPendingTx(hash, "createRaffle");
        creationPhase = "CREATING_RAFFLE";
      } else {
        // Approve didn't land yet or timed out -- retry from IDLE
        console.log("[scheduler] Approve not yet confirmed, retrying from IDLE");
        creationPhase = "IDLE";
      }
      break;
    }

    case "CREATING_RAFFLE": {
      // Waiting for createRaffle TX -- pendingTx should be set
      // If we get here with no pendingTx, it means create was confirmed (vault set in checkPendingTxConfirmed)
      // or timed out
      if (currentVault) {
        // Already set by checkPendingTxConfirmed
        creationPhase = "IDLE";
        return;
      }

      // Check if vault appeared (maybe TX confirmed between ticks)
      const newVault = await detectNewVault(creationVaultCountBefore);
      if (newVault) {
        currentVault = newVault;
        creationPhase = "IDLE";

        saveRaffleMeta({
          vault: newVault,
          name: creationRaffleName,
          description: config.raffle.description,
          type: "house",
          coverImage: randomCoverImage(),
          creator: getAgentAddress(),
          createdAt: new Date().toISOString(),
        });

        const db = await import("./db.js");
        try {
          await db.upsertRaffle({
            vault: newVault,
            name: creationRaffleName,
            type: "house",
            state: "OPEN",
            pool: "0",
            participants: 0,
            ticketPrice: (Number(config.raffle.ticketPriceUsd6) / 1e6).toFixed(2),
            closesAt: new Date(Date.now() + Number(config.raffle.duration) * 1000),
            creator: getAgentAddress(),
          });
        } catch {}

        setServerPhase("OPEN");
        console.log("[scheduler] House raffle active:", newVault);

        try {
          const info = await getRaffleInfo(newVault);
          const { formatUsd6 } = await import("./html.js");
          broadcast({
            type: "new_raffle",
            vault: newVault,
            name: creationRaffleName,
            closesAt: Number(info.closesAt) * 1000,
            ticketPrice: formatUsd6(config.raffle.ticketPriceUsd6),
            raffleType: "house",
          });
        } catch {}
      } else {
        // Create TX didn't land yet or timed out -- retry from IDLE
        console.log("[scheduler] createRaffle not yet confirmed, retrying from IDLE");
        creationPhase = "IDLE";
      }
      break;
    }
  }
}

// ============ Orphan check (unchanged, uses blocking closeRaffle) ============

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
      if (vault === currentVault) continue;

      let info;
      try {
        info = await getRaffleInfo(vault);
      } catch {
        await db.upsertRaffle({ vault, state: "INVALID", settledAt: new Date() });
        console.log(`[scheduler] Orphan check: marked stale vault as INVALID: ${vault}`);
        continue;
      }

      if (info.state !== RaffleState.OPEN) {
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

// ============ Start ============

export async function startScheduler(
  beneficiaries: Address[]
): Promise<NodeJS.Timeout> {
  console.log(
    `[scheduler] Starting with ${config.pollIntervalMs}ms poll interval (fire-and-forget mode)`
  );

  await recoverExistingRaffle();
  startOrphanCheckCron();

  // Run first tick immediately
  await runSchedulerTick(beneficiaries);

  return setInterval(() => runSchedulerTick(beneficiaries), config.pollIntervalMs);
}

export function getCurrentVault(): Address | null {
  return currentVault;
}
