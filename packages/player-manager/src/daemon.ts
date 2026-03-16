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
let earlyWaveDone: string | null = null;  // vault we've done early wave for
let lateWaveDone: string | null = null;   // vault we've done late wave for
let earlyWavePlayers: string[] = [];      // names entered in early wave

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
  const elapsed = now - (closesAt - 3600000); // approx time since raffle started (assuming 1h)
  const remaining = closesAt - now;
  const remainingMin = Math.floor(remaining / 60000);
  const participants = parseInt(raffle.participants) || 0;

  // ── EARLY WAVE: first 15 minutes, seed the pot with 2-4 house players ──
  if (earlyWaveDone !== vault && elapsed > 60000 && remaining > 45 * 60000) {
    earlyWaveDone = vault;

    const activePlayers = getActivePlayers();
    const numSeed = 3 + Math.floor(Math.random() * 3); // 3-5
    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
    const seedPlayers = shuffled.slice(0, numSeed);

    // Each player buys a random number of tickets (1-5) by entering multiple times
    console.log(`[daemon] Early wave: entering ${seedPlayers.length} players to seed pot`);

    for (const player of seedPlayers) {
      const ticketCount = 1 + Math.floor(Math.random() * 5); // 1-5 tickets
      try {
        for (let t = 0; t < ticketCount; t++) {
          const { entered } = await enterRaffle(seedPassword, vault as Address, [player]);
          if (entered.length > 0 && t === 0) {
            earlyWavePlayers.push(player.name);
          }
          if (entered.length > 0) {
            console.log(`[daemon] ☕ ${player.name} ticket ${t+1}/${ticketCount}`);
          }
        }
      } catch (e) {
        console.log(`[daemon] ${player.name} failed: ${String(e).slice(0, 60)}`);
      }
      // Stagger between players (15-45s)
      await new Promise((r) => setTimeout(r, 15000 + Math.random() * 30000));
    }

    await sendAlert(`Early wave: **${earlyWavePlayers.length}** house players seeded the pot`);
    return;
  }

  // ── LATE WAVE: final 10 minutes, top up if organic participation is low ──
  if (lateWaveDone !== vault && remaining < 10 * 60000 && remaining > 3 * 60000) {
    lateWaveDone = vault;

    // Check how many organic (non-house) players are in
    const organicCount = Math.max(0, participants - earlyWavePlayers.length);

    if (organicCount < 3) {
      // Low organic activity — add more house players
      const activePlayers = getActivePlayers();
      const alreadyIn = new Set(earlyWavePlayers.map(n => n.toLowerCase()));
      const available = activePlayers.filter(p => !alreadyIn.has(p.name.toLowerCase()));
      const numExtra = 3 + Math.floor(Math.random() * 5); // 3-7 more
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const latePlayers = shuffled.slice(0, numExtra);

      console.log(`[daemon] Late wave: ${organicCount} organic players detected, entering ${latePlayers.length} more house players`);

      for (const player of latePlayers) {
        try {
          const check = await fetchJson<{ current: CurrentRaffle | null }>(`${APP_URL}/api/raffles/current`);
          if (!check?.current || check.current.address !== vault || check.current.state !== "OPEN") break;

          const { entered } = await enterRaffle(seedPassword, vault as Address, [player]);
          if (entered.length > 0) {
            console.log(`[daemon] ☕ ${entered[0]}`);
          }
        } catch (e) {
          console.log(`[daemon] ${player.name} failed: ${String(e).slice(0, 60)}`);
        }
        await new Promise((r) => setTimeout(r, 3000 + Math.random() * 8000));
      }

      await sendAlert(`Late wave: **${latePlayers.length}** more house players entered (only ${organicCount} organic)`);
    } else {
      console.log(`[daemon] Late wave: ${organicCount} organic players — house players not needed`);
      await sendAlert(`Healthy raffle: **${organicCount}** organic + **${earlyWavePlayers.length}** house players`);
    }
    return;
  }

  // ── Between waves: just log status ──
  console.log(`[daemon] ${vault.slice(0,10)}... pool=$${raffle.totalPool} participants=${participants} (${remainingMin}m left)`);
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
