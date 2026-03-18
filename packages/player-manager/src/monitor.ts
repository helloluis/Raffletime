/**
 * Balance monitoring with Telegram alerts.
 * Checks all player balances periodically. Alerts on:
 * - Low balance (player can't afford next raffle)
 * - High balance (player won big, should sweep)
 * - Zero ETH (can't pay gas)
 */

import { createPublicClient, http, defineChain, type Address } from "viem";
import { loadRegistry, type Player } from "./registry.js";
import { config } from "./config.js";

function formatUsd6(raw: bigint): string {
  return (Number(raw) / 1e6).toFixed(2);
}

// Cooldown: don't re-alert the same player more than once per 6 hours
const lastAlerted = new Map<string, number>();
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const chain = defineChain({
  id: config.chainId,
  name: config.chainId === 8453 ? "Base" : "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

/** Get a player's USDC balance (6-decimal bigint) */
export async function getPlayerBalance(address: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
    args: [address],
  })) as bigint;
}

// ============ Alerting (generic webhook) ============

async function sendAlert(message: string): Promise<void> {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.alertApiKey}`,
      },
      body: JSON.stringify({
        message,
        source: "raffletime",
      }),
    });
  } catch (e) {
    console.error("[monitor] Alert send failed:", e);
  }
}

// ============ Balance check ============

export async function checkBalances(): Promise<string[]> {
  const players = loadRegistry().filter((p) => !p.paused);
  const alerts: string[] = [];
  const lowThreshold = BigInt(config.lowBalanceThreshold);
  const highThreshold = BigInt(config.highBalanceThreshold);

  for (const player of players) {
    const addr = player.address as Address;

    // Check token balance
    let tokenBal = 0n;
    try {
      tokenBal = (await publicClient.readContract({
        address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
        args: [addr],
      })) as bigint;
    } catch { continue; }

    // Check CELO balance
    let ethBal = 0n;
    try {
      ethBal = await publicClient.getBalance({ address: addr });
    } catch { continue; }

    const now = Date.now();
    const lastAlert = lastAlerted.get(player.address) ?? 0;
    const onCooldown = now - lastAlert < ALERT_COOLDOWN_MS;

    const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    // Low token balance
    if (tokenBal < lowThreshold && player.registered && !onCooldown) {
      alerts.push(`⚠️ *Low balance*: **${player.name}** (${short}) has $${formatUsd6(tokenBal)}`);
      lastAlerted.set(player.address, now);
    }

    // High token balance (won big) — no cooldown, always useful to know
    if (tokenBal > highThreshold) {
      alerts.push(`💰 *High balance*: **${player.name}** (${short}) has $${formatUsd6(tokenBal)} — consider sweeping`);
    }

    // Zero ETH (can't transact)
    if (ethBal === 0n && player.registered && !onCooldown) {
      alerts.push(`🚨 *No gas*: **${player.name}** (${short}) has 0 ETH`);
      lastAlerted.set(player.address, now);
    }
  }

  // Check house agent balance (treasury = house agent wallet)
  if (config.treasuryKey) {
    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      const houseAddr = privateKeyToAccount(config.treasuryKey).address;
      const houseBal = await getPlayerBalance(houseAddr);
      const houseShort = `${houseAddr.slice(0, 6)}...${houseAddr.slice(-4)}`;
      const houseKey = `house:${houseAddr}`;
      const lastHouseAlert = lastAlerted.get(houseKey) ?? 0;
      const houseOnCooldown = Date.now() - lastHouseAlert < ALERT_COOLDOWN_MS;

      if (houseBal < BigInt(2_000_000) && !houseOnCooldown) { // < $2
        alerts.push(`🏠 *House agent low*: (${houseShort}) has $${formatUsd6(houseBal)} — needs USDC for raffle deposits`);
        lastAlerted.set(houseKey, Date.now());
      }
    } catch {}
  }

  return alerts;
}

// ============ Monitor loop ============

let monitorInterval: NodeJS.Timeout | null = null;

export function startMonitor(intervalMs: number = 15 * 60 * 1000): void {
  console.log(`[monitor] Starting balance monitor (every ${intervalMs / 60000}m)`);

  const run = async () => {
    try {
      const alerts = await checkBalances();
      if (alerts.length > 0) {
        console.log(`[monitor] ${alerts.length} alert(s):`);
        for (const alert of alerts) console.log(`  ${alert}`);
        // Send as a single batched message
        await sendAlert(alerts.join("\n"));
      } else {
        console.log("[monitor] All balances OK");
      }
    } catch (e) {
      console.error("[monitor] Check failed:", e);
    }
  };

  // Run immediately, then on interval
  run();
  monitorInterval = setInterval(run, intervalMs);
}

export function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
