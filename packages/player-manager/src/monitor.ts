/**
 * Balance monitoring with Telegram alerts.
 * Checks all player balances periodically. Alerts on:
 * - Low balance (player can't afford next raffle)
 * - High balance (player won big, should sweep)
 * - Zero CELO (can't pay gas)
 */

import { createPublicClient, http, formatEther, defineChain, type Address } from "viem";
import { loadRegistry, type Player } from "./registry.js";
import { config } from "./config.js";

const chain = defineChain({
  id: config.chainId,
  name: config.chainId === 42220 ? "Celo" : "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

// ============ Alerting (generic webhook) ============

async function sendAlert(message: string): Promise<void> {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "raffletime-player-manager",
        message,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("[monitor] Alert webhook failed:", e);
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
    let celoBal = 0n;
    try {
      celoBal = await publicClient.getBalance({ address: addr });
    } catch { continue; }

    // Low token balance
    if (tokenBal < lowThreshold && player.registered) {
      const msg = `⚠️ *Low balance*: ${player.name} has $${parseFloat(formatEther(tokenBal)).toFixed(2)} tokens`;
      alerts.push(msg);
    }

    // High token balance (won big)
    if (tokenBal > highThreshold) {
      const msg = `💰 *High balance*: ${player.name} has $${parseFloat(formatEther(tokenBal)).toFixed(2)} tokens — consider sweeping`;
      alerts.push(msg);
    }

    // Zero CELO (can't transact)
    if (celoBal === 0n && player.registered) {
      const msg = `🚨 *No gas*: ${player.name} has 0 CELO — cannot transact`;
      alerts.push(msg);
    }
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
        for (const alert of alerts) {
          console.log(`  ${alert}`);
          await sendAlert(alert);
        }
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
