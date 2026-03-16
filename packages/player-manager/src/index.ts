#!/usr/bin/env node
/**
 * Player Manager CLI
 *
 * Usage:
 *   player-manager init                     Generate HD seed (interactive)
 *   player-manager create <count>           Create N new players
 *   player-manager fund                     Fund all players from treasury
 *   player-manager register                 Register unregistered players on-chain
 *   player-manager enter <vault>            Enter all active players into a raffle
 *   player-manager rebalance                Rebalance token balances between players
 *   player-manager sweep                    Sweep excess winnings to cold wallet
 *   player-manager status                   Show all players with balances and P&L
 *   player-manager monitor                  Start balance monitoring daemon
 *   player-manager pause <name>             Pause a player
 *   player-manager resume <name>            Resume a player
 */

import "dotenv/config";
import { type Address } from "viem";
import { initSeed, seedExists } from "./wallet.js";
import { loadRegistry, updatePlayer, getPlayer } from "./registry.js";
import {
  createPlayers, fundPlayers, registerPlayers,
  enterRaffle, rebalancePlayers, sweepWinnings, getStatus,
} from "./operations.js";
import { startMonitor, checkBalances } from "./monitor.js";
import { config } from "./config.js";

const [, , command, ...args] = process.argv;

async function main() {
  console.log("=== RaffleTime Player Manager ===");
  console.log(`Chain: ${config.chainId}`);
  console.log(`Players: ${loadRegistry().length}`);
  console.log("");

  switch (command) {
    case "init": {
      if (seedExists()) {
        console.log("Seed already exists. Delete data/seed.enc to regenerate.");
        break;
      }
      if (!config.seedPassword) {
        console.error("Set SEED_PASSWORD env var before running init.");
        process.exit(1);
      }
      initSeed(config.seedPassword);
      break;
    }

    case "create": {
      const count = parseInt(args[0] || "5");
      if (!config.seedPassword) { console.error("Set SEED_PASSWORD"); process.exit(1); }
      console.log(`Creating ${count} players...`);
      const players = await createPlayers(count, config.seedPassword, {
        riskProfile: (args[1] as any) || "moderate",
      });
      console.log(`\nCreated ${players.length} players.`);
      break;
    }

    case "fund": {
      if (!config.seedPassword || !config.treasuryKey) {
        console.error("Set SEED_PASSWORD and TREASURY_PRIVATE_KEY");
        process.exit(1);
      }
      console.log("Funding players...");
      await fundPlayers(config.seedPassword, config.treasuryKey);
      console.log("Done.");
      break;
    }

    case "register": {
      if (!config.seedPassword) { console.error("Set SEED_PASSWORD"); process.exit(1); }
      console.log("Registering players on-chain...");
      await registerPlayers(config.seedPassword);
      console.log("Done.");
      break;
    }

    case "enter": {
      const vault = args[0] as Address;
      if (!vault) { console.error("Usage: enter <vault_address>"); process.exit(1); }
      if (!config.seedPassword) { console.error("Set SEED_PASSWORD"); process.exit(1); }
      console.log(`Entering raffle ${vault}...`);
      const { entered, skipped } = await enterRaffle(config.seedPassword, vault);
      console.log(`\nEntered: ${entered.length}`);
      entered.forEach((e) => console.log(`  ✓ ${e}`));
      if (skipped.length) {
        console.log(`Skipped: ${skipped.length}`);
        skipped.forEach((s) => console.log(`  - ${s}`));
      }
      break;
    }

    case "rebalance": {
      if (!config.seedPassword) { console.error("Set SEED_PASSWORD"); process.exit(1); }
      console.log("Rebalancing player balances...");
      await rebalancePlayers(config.seedPassword);
      console.log("Done.");
      break;
    }

    case "sweep": {
      if (!config.seedPassword || !config.coldWallet) {
        console.error("Set SEED_PASSWORD and COLD_WALLET_ADDRESS");
        process.exit(1);
      }
      console.log(`Sweeping winnings to ${config.coldWallet}...`);
      await sweepWinnings(config.seedPassword, config.coldWallet);
      console.log("Done.");
      break;
    }

    case "status": {
      if (!config.seedPassword) { console.error("Set SEED_PASSWORD"); process.exit(1); }
      const lines = await getStatus(config.seedPassword);
      lines.forEach((l) => console.log(l));
      break;
    }

    case "monitor": {
      console.log("Starting balance monitor...");
      startMonitor();
      // Keep process alive
      process.on("SIGINT", () => { console.log("\nStopping monitor."); process.exit(0); });
      break;
    }

    case "pause": {
      const name = args[0];
      if (!name) { console.error("Usage: pause <player_name>"); process.exit(1); }
      const p = getPlayer(name);
      if (!p) { console.error(`Player "${name}" not found`); process.exit(1); }
      updatePlayer(p.index, { paused: true });
      console.log(`${p.name} paused.`);
      break;
    }

    case "resume": {
      const name = args[0];
      if (!name) { console.error("Usage: resume <player_name>"); process.exit(1); }
      const p = getPlayer(name);
      if (!p) { console.error(`Player "${name}" not found`); process.exit(1); }
      updatePlayer(p.index, { paused: false });
      console.log(`${p.name} resumed.`);
      break;
    }

    default:
      console.log("Commands: init, create, fund, register, enter, rebalance, sweep, status, monitor, pause, resume");
      break;
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
