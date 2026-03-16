import "dotenv/config";
import { serve } from "@hono/node-server";
import { type Address } from "viem";
import { createApi } from "./api.js";
import { startScheduler } from "./scheduler.js";
import { ensureAgentRegistered } from "./raffle-lifecycle.js";
import { config } from "./config.js";

async function main() {
  console.log("=== RaffleTime House Agent ===");
  console.log(`Chain: ${config.chainId}`);
  console.log(`Port: ${config.port}`);

  // Validate configuration
  if (config.contracts.factory === "0x") {
    console.log(
      "\n[SETUP MODE] Contract addresses not configured."
    );
    console.log("Set these environment variables:");
    console.log("  FACTORY_ADDRESS=0x...");
    console.log("  REGISTRY_ADDRESS=0x...");
    console.log("  AGENT_REGISTRY_ADDRESS=0x...");
    console.log("  PRIVATE_KEY=0x...");
    console.log("\nStarting API server in read-only mode...\n");
  } else if (!config.privateKey) {
    console.log("\n[READ-ONLY MODE] No PRIVATE_KEY set. API only.\n");
  } else if (process.env.READONLY === "true") {
    console.log("\n[READ-ONLY MODE] READONLY=true. Tracking on-chain state without creating raffles.");
    console.log("[READ-ONLY MODE] SSE and API endpoints active. Connect to testnet.raffletime.io for live data.\n");
  } else {
    // Full mode — register agent and start scheduler
    try {
      await ensureAgentRegistered();

      // Beneficiary addresses (configure via env or hardcode for now)
      const beneficiaries: Address[] = (
        process.env.BENEFICIARIES || ""
      )
        .split(",")
        .filter(Boolean)
        .map((addr) => addr.trim() as Address);

      await startScheduler(beneficiaries);
    } catch (error) {
      console.error("[main] Failed to initialize:", error);
      console.log("[main] Starting API server anyway...");
    }
  }

  // Start HTTP server
  const app = createApi();
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`\n[api] Server listening on http://localhost:${info.port}`);
    console.log(
      `[api] Agent manifest: http://localhost:${info.port}/.well-known/agent.json`
    );
    console.log(
      `[api] Health check: http://localhost:${info.port}/api/health`
    );
  });
}

main().catch(console.error);
