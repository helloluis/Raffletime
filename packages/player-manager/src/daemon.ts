/**
 * Autonomous player daemon.
 * Polls the main raffletime app for active raffles and enters house players automatically.
 * Pre-checks balances before entry, gracefully reassigns broke players.
 */

import { type Address } from "viem";
import { loadSeed } from "./wallet.js";
import { loadRegistry, getActivePlayers, ticketsForProfile } from "./registry.js";
import { enterRaffle, createPlayers, fundPlayers, registerPlayers, rebalancePlayers } from "./operations.js";
import { checkBalances, getPlayerBalance } from "./monitor.js";
import { config } from "./config.js";

const APP_URL = process.env.APP_URL || "https://raffletime.io";
const POLL_INTERVAL = parseInt(process.env.DAEMON_POLL_MS || "30000"); // 30s
const TARGET_REGISTERED = parseInt(process.env.TARGET_REGISTERED || "30");
const MIN_BALANCE_TO_PLAY = BigInt(process.env.MIN_PLAY_BALANCE || "200000"); // $0.20 USDC

let lastVault: string | null = null;
let earlyWaveDone: string | null = null;
let lateWaveDone: string | null = null;
let earlyWavePlayers: string[] = [];

interface CurrentRaffle {
  address: string;
  state: string;
  totalPool: string;
  participants: string;
  closesAt: string;
  ticketPrice: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function sendAlert(message: string) {
  if (!config.alertWebhookUrl || !config.alertApiKey) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.alertApiKey}`,
      },
      body: JSON.stringify({ message, source: "raffletime" }),
    });
  } catch {}
}

/**
 * Get players who are funded and ready to play.
 * Checks on-chain USDC balance — only returns players with >= MIN_BALANCE_TO_PLAY.
 */
async function getFundedPlayers(): Promise<ReturnType<typeof getActivePlayers>> {
  const active = getActivePlayers();
  const funded: typeof active = [];

  for (const p of active) {
    try {
      const bal = await getPlayerBalance(p.address as Address);
      if (bal >= MIN_BALANCE_TO_PLAY) {
        funded.push(p);
      }
    } catch {
      // Can't check balance — skip this player
    }
  }

  return funded;
}

async function ensureEnoughPlayers(seedPassword: string): Promise<void> {
  const players = loadRegistry();
  const registered = players.filter((p) => p.registered && !p.paused);

  if (registered.length >= TARGET_REGISTERED) return;

  const needed = TARGET_REGISTERED - players.length;
  if (needed > 0) {
    console.log(`[daemon] Creating ${needed} new players to reach ${TARGET_REGISTERED}...`);
    await createPlayers(needed, seedPassword, {
      riskProfile: ["conservative", "moderate", "aggressive"][Math.floor(Math.random() * 3)] as any,
    });
  }

  if (config.treasuryKey) {
    console.log("[daemon] Funding unfunded players...");
    await fundPlayers(seedPassword, config.treasuryKey);
  }

  const unregistered = loadRegistry().filter((p) => !p.registered && !p.paused);
  if (unregistered.length > 0) {
    console.log(`[daemon] Registering ${unregistered.length} players...`);
    await registerPlayers(seedPassword);
  }
}

/**
 * Enter a single player into a raffle with retry.
 * On nonce error, waits 3s and retries once (Base Sepolia RPC returns stale nonces).
 */
async function enterPlayerWithRetry(
  seedPassword: string,
  vault: Address,
  player: ReturnType<typeof getActivePlayers>[0]
): Promise<{ success: boolean; message: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { entered, skipped } = await enterRaffle(seedPassword, vault, [player]);
      if (entered.length > 0) {
        return { success: true, message: entered[0] };
      }
      if (skipped.length > 0) {
        // If it's a nonce error and first attempt, retry after a pause
        if (attempt === 0 && skipped[0].includes("Nonce")) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        return { success: false, message: skipped[0] };
      }
      return { success: false, message: `${player.name}: unknown result` };
    } catch (e) {
      if (attempt === 0 && String(e).includes("Nonce")) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return { success: false, message: `${player.name}: ${String(e).slice(0, 60)}` };
    }
  }
  return { success: false, message: `${player.name}: failed after retry` };
}

async function tick(seedPassword: string): Promise<void> {
  // 1. Check app health
  const health = await fetchJson<{ status: string; chainId: number }>(`${APP_URL}/api/health`);
  if (!health) {
    console.log("[daemon] App unreachable, skipping tick");
    return;
  }
  if (health.chainId !== config.chainId) {
    console.log(`[daemon] Chain mismatch: app=${health.chainId} us=${config.chainId}, skipping`);
    return;
  }

  // 2. Get current raffle
  const current = await fetchJson<{ current: CurrentRaffle | null }>(`${APP_URL}/api/raffles/current`);
  if (!current?.current) {
    console.log("[daemon] No active raffle");
    return;
  }

  const raffle = current.current;
  const vault = raffle.address;

  if (raffle.state !== "OPEN") {
    console.log(`[daemon] Raffle ${vault.slice(0, 10)}... is ${raffle.state}`);
    return;
  }

  // Track new raffle
  if (vault !== lastVault) {
    console.log(`[daemon] New raffle detected: ${vault}`);
    lastVault = vault;
    earlyWaveDone = null;
    lateWaveDone = null;
    earlyWavePlayers = [];
    await ensureEnoughPlayers(seedPassword);
  }

  const closesAt = new Date(raffle.closesAt).getTime();
  const now = Date.now();
  const remaining = closesAt - now;
  const remainingMin = Math.floor(remaining / 60000);
  const participants = parseInt(raffle.participants) || 0;

  // ── EARLY WAVE: when > 15 min remaining, seed the pot ──
  if (earlyWaveDone !== vault && remaining > 15 * 60000) {
    earlyWaveDone = vault;

    // Pre-filter to only funded players
    const fundedPlayers = await getFundedPlayers();
    if (fundedPlayers.length === 0) {
      console.log("[daemon] Early wave: no funded players available!");
      await sendAlert("⚠ Early wave: ALL house players are broke. Fund treasury.");
      return;
    }

    const numSeed = Math.min(3 + Math.floor(Math.random() * 3), fundedPlayers.length); // 3-5
    const shuffled = [...fundedPlayers].sort(() => Math.random() - 0.5);
    const candidates = shuffled.slice(0, numSeed + 3); // take extras as backups

    console.log(`[daemon] Early wave: ${fundedPlayers.length} funded players, entering ${numSeed}`);

    let entered = 0;
    for (const player of candidates) {
      if (entered >= numSeed) break;

      const ticketCount = 3 + Math.floor(Math.random() * 3); // 3-5 tickets
      let playerEntered = false;

      for (let t = 0; t < ticketCount; t++) {
        const result = await enterPlayerWithRetry(seedPassword, vault as Address, player);
        if (result.success) {
          if (!playerEntered) {
            earlyWavePlayers.push(player.name);
            playerEntered = true;
            entered++;
          }
          console.log(`[daemon] ☕ ${player.name} ticket ${t + 1}/${ticketCount}`);
        } else {
          console.log(`[daemon] ⚠ ${result.message}`);
          break; // stop tickets for this player, try next
        }
        if (t < ticketCount - 1) {
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
        }
      }

      // Stagger between players
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 15000));
    }

    console.log(`[daemon] Early wave done: ${entered} players entered`);
    await sendAlert(`Early wave: **${entered}** house players seeded the pot`);
    return;
  }

  // ── LATE WAVE: final 10 minutes, top up if participation is low ──
  if (lateWaveDone !== vault && remaining < 10 * 60000 && remaining > 3 * 60000) {
    lateWaveDone = vault;

    const organicCount = Math.max(0, participants - earlyWavePlayers.length);

    if (organicCount < 3) {
      const fundedPlayers = await getFundedPlayers();
      const alreadyIn = new Set(earlyWavePlayers.map(n => n.toLowerCase()));
      const available = fundedPlayers.filter(p => !alreadyIn.has(p.name.toLowerCase()));
      const numExtra = Math.min(2 + Math.floor(Math.random() * 3), available.length); // 2-4
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const lateCandidates = shuffled.slice(0, numExtra + 2); // extras as backups

      console.log(`[daemon] Late wave: ${organicCount} organic, entering up to ${numExtra} more (${available.length} funded available)`);

      let entered = 0;
      for (const player of lateCandidates) {
        if (entered >= numExtra) break;

        // Re-check raffle is still open
        const check = await fetchJson<{ current: CurrentRaffle | null }>(`${APP_URL}/api/raffles/current`);
        if (!check?.current || check.current.address !== vault || check.current.state !== "OPEN") break;

        const lateTickets = 2 + Math.floor(Math.random() * 2); // 2-3 tickets
        let playerOk = false;
        for (let t = 0; t < lateTickets; t++) {
          const result = await enterPlayerWithRetry(seedPassword, vault as Address, player);
          if (result.success) {
            if (!playerOk) { playerOk = true; entered++; }
            console.log(`[daemon] ☕ ${player.name} ticket ${t + 1}/${lateTickets}`);
          } else {
            console.log(`[daemon] ⚠ ${result.message}`);
            break;
          }
          if (t < lateTickets - 1) await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 8000));
      }

      await sendAlert(`Late wave: **${entered}** more house players entered (${organicCount} organic)`);
    } else {
      console.log(`[daemon] Late wave: ${organicCount} organic players — house players not needed`);
    }
    return;
  }

  // ── Between waves: just log status ──
  console.log(`[daemon] ${vault.slice(0, 10)}... pool=$${raffle.totalPool} participants=${participants} (${remainingMin}m left)`);
}

export async function startDaemon(): Promise<void> {
  if (!config.seedPassword) {
    console.error("[daemon] SEED_PASSWORD required");
    process.exit(1);
  }

  console.log(`[daemon] Starting autonomous player daemon`);
  console.log(`[daemon] App: ${APP_URL}`);
  console.log(`[daemon] Chain: ${config.chainId}`);
  console.log(`[daemon] Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`[daemon] Target registered: ${TARGET_REGISTERED}`);
  console.log(`[daemon] Min balance to play: $${Number(MIN_BALANCE_TO_PLAY) / 1e6}`);
  console.log("");

  await sendAlert("🟢 RaffleTime house player daemon started");

  // Initial setup
  await ensureEnoughPlayers(config.seedPassword);

  // Run balance check
  const alerts = await checkBalances();
  for (const a of alerts) {
    console.log(`[monitor] ${a}`);
    await sendAlert(a);
  }

  // Main loop
  const loop = async () => {
    try {
      await tick(config.seedPassword);
    } catch (e) {
      console.error("[daemon] Tick error:", e);
    }
  };

  await loop();
  setInterval(loop, POLL_INTERVAL);

  // Balance check every 15 minutes
  setInterval(async () => {
    const alerts = await checkBalances();
    for (const a of alerts) {
      console.log(`[monitor] ${a}`);
      await sendAlert(a);
    }
  }, 15 * 60 * 1000);

  // Hourly funding + rebalance at minute 5 of every hour
  let lastFundingHour = -1;
  setInterval(async () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    if (minute !== 5 || hour === lastFundingHour) return;
    lastFundingHour = hour;

    console.log("[daemon] Hourly funding check...");
    try {
      await rebalancePlayers(config.seedPassword);
    } catch (e) {
      console.log(`[daemon] Rebalance error: ${String(e).slice(0, 80)}`);
    }

    if (config.treasuryKey) {
      try {
        await fundPlayers(config.seedPassword, config.treasuryKey, {
          tokenAmount: BigInt(1_000_000), // top up to $1 USDC
        });
      } catch (e) {
        console.log(`[daemon] Treasury funding error: ${String(e).slice(0, 80)}`);
      }
    }
  }, 30_000);

  console.log("[daemon] Running. Press Ctrl+C to stop.");
}
