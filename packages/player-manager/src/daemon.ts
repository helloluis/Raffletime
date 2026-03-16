/**
 * Autonomous player daemon.
 * Polls the main raffletime app for active raffles and enters house players automatically.
 * Detects testnet/mainnet from the app's health endpoint.
 */

import { type Address } from "viem";
import { loadSeed } from "./wallet.js";
import { loadRegistry, getActivePlayers, ticketsForProfile } from "./registry.js";
import { enterRaffle, createPlayers, fundPlayers, registerPlayers } from "./operations.js";
import { checkBalances } from "./monitor.js";
import { config } from "./config.js";

const APP_URL = process.env.APP_URL || "https://raffletime.io";
const POLL_INTERVAL = parseInt(process.env.DAEMON_POLL_MS || "30000"); // 30s
const MIN_PLAYERS_PER_RAFFLE = parseInt(process.env.MIN_PLAYERS || "8");
const MAX_PLAYERS_PER_RAFFLE = parseInt(process.env.MAX_PLAYERS || "20");
const TARGET_REGISTERED = parseInt(process.env.TARGET_REGISTERED || "30");

let lastVault: string | null = null;
let lastEnteredVault: string | null = null;

interface AppHealth {
  status: string;
  agent: string;
  currentVault: string | null;
  chainId: number;
}

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

  // Fund unregistered players
  if (config.treasuryKey) {
    console.log("[daemon] Funding unfunded players...");
    await fundPlayers(seedPassword, config.treasuryKey);
  }

  // Register unregistered players
  const unregistered = loadRegistry().filter((p) => !p.registered && !p.paused);
  if (unregistered.length > 0) {
    console.log(`[daemon] Registering ${unregistered.length} players...`);
    await registerPlayers(seedPassword);
  }
}

async function tick(seedPassword: string): Promise<void> {
  // 1. Check app health — detect chain
  const health = await fetchJson<AppHealth>(`${APP_URL}/api/health`);
  if (!health) {
    console.log("[daemon] App unreachable, skipping tick");
    return;
  }

  // Verify we're on the same chain
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

  // 3. Skip if not OPEN or already entered this raffle
  if (raffle.state !== "OPEN") {
    console.log(`[daemon] Raffle ${vault.slice(0,10)}... is ${raffle.state}`);
    return;
  }

  if (vault === lastEnteredVault) {
    // Already planned entries for this raffle — check if it's time to enter the next player
    const remaining = new Date(raffle.closesAt).getTime() - Date.now();
    if (remaining > 0) {
      console.log(`[daemon] Waiting... ${vault.slice(0,10)}... pool=$${raffle.totalPool} participants=${raffle.participants} (${Math.floor(remaining/60000)}m left)`);
    }
    return;
  }

  // 4. New raffle detected — plan staggered entries
  console.log(`[daemon] New raffle detected: ${vault}`);
  lastVault = vault;
  lastEnteredVault = vault;

  // Ensure we have enough players
  await ensureEnoughPlayers(seedPassword);

  // Pick random number of players
  const activePlayers = getActivePlayers();
  const numToEnter = Math.min(
    activePlayers.length,
    MIN_PLAYERS_PER_RAFFLE + Math.floor(Math.random() * (MAX_PLAYERS_PER_RAFFLE - MIN_PLAYERS_PER_RAFFLE + 1))
  );

  // Shuffle and pick
  const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, numToEnter);

  // Calculate stagger: spread entries over the raffle's lifetime minus last 3 minutes
  const closesAt = new Date(raffle.closesAt).getTime();
  const now = Date.now();
  const totalWindow = closesAt - now - (3 * 60 * 1000); // stop 3 min before close
  const intervalMs = totalWindow > 0 ? Math.floor(totalWindow / selected.length) : 10000;

  console.log(`[daemon] Scheduling ${selected.length} players over ${Math.floor(totalWindow/60000)}m (${Math.floor(intervalMs/1000)}s apart)`);

  // Enter players one at a time with staggered delays
  let enteredCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const player = selected[i];

    // Wait for the scheduled time (except first player enters immediately)
    if (i > 0) {
      // Add some jitter (±20%) to look more natural
      const jitter = intervalMs * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, jitter));
    }

    // Verify raffle is still open before entering
    try {
      const check = await fetchJson<{ current: CurrentRaffle | null }>(`${APP_URL}/api/raffles/current`);
      if (!check?.current || check.current.address !== vault || check.current.state !== "OPEN") {
        console.log(`[daemon] Raffle no longer open, stopping entries`);
        break;
      }
    } catch {}

    try {
      const { entered, skipped } = await enterRaffle(seedPassword, vault as Address, [player]);
      if (entered.length > 0) {
        enteredCount++;
        console.log(`[daemon] ${entered[0]}`);
      }
      if (skipped.length > 0) {
        skippedCount++;
        console.log(`[daemon] Skip: ${skipped[0]}`);
      }
    } catch (e) {
      console.log(`[daemon] ${player.name} failed: ${String(e).slice(0, 60)}`);
      skippedCount++;
    }
  }

  const summary = `Raffle entry complete: **${enteredCount}** entered, **${skippedCount}** skipped over ${Math.floor(totalWindow/60000)}m`;
  console.log(`[daemon] ${summary}`);
  if (enteredCount > 0) {
    await sendAlert(summary);
  }
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
  console.log(`[daemon] Players per raffle: ${MIN_PLAYERS_PER_RAFFLE}-${MAX_PLAYERS_PER_RAFFLE}`);
  console.log(`[daemon] Target registered: ${TARGET_REGISTERED}`);
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

  console.log("[daemon] Running. Press Ctrl+C to stop.");
}
