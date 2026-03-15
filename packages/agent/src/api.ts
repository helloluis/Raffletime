import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address, formatEther } from "viem";
import {
  getActiveRaffles,
  getRaffleInfo,
  RaffleState,
} from "./raffle-lifecycle.js";
import { getCurrentVault } from "./scheduler.js";
import { publicClient, getAgentAddress, getWalletClient } from "./chain.js";
import { AgentRegistryAbi, ERC20Abi, RaffleVaultAbi } from "./abis.js";
import { config } from "./config.js";
import { createX402Middleware } from "./x402.js";
import { getRaffleMeta, getAllRaffleMeta, type RaffleMeta } from "./raffle-store.js";

export function createApi(): Hono {
  const app = new Hono();

  app.use("/*", cors());

  // x402 payment gate — protects POST /api/raffles/:address/enter
  // Only active when X402_ENABLED=true in .env
  const x402 = createX402Middleware();
  if (x402) {
    app.use(x402);
  }

  // ============ Agent discovery (ERC-8004 / agent.json) ============

  app.get("/.well-known/agent.json", (c) => {
    return c.json({
      name: "RaffleTime House Agent",
      version: "0.1.0",
      description:
        "Operates hourly house raffles on RaffleTime. Creates raffles, monitors lifecycle, triggers draws and payouts.",
      url: `http://localhost:${config.port}`,
      capabilities: [
        "raffle-creation",
        "raffle-monitoring",
        "raffle-settlement",
      ],
      endpoints: {
        raffles: "/api/raffles",
        current: "/api/raffles/current",
        enter: "/api/raffles/enter",
        health: "/api/health",
      },
      chain: {
        id: config.chainId,
        contracts: config.contracts,
      },
    });
  });

  // ============ Health ============

  app.get("/api/health", async (c) => {
    let agentAddress: string | null = null;
    try {
      agentAddress = getAgentAddress();
    } catch {
      // No private key configured
    }

    return c.json({
      status: "ok",
      agent: agentAddress,
      currentVault: getCurrentVault(),
      chainId: config.chainId,
      timestamp: new Date().toISOString(),
    });
  });

  // ============ Raffles ============

  app.get("/api/raffles", async (c) => {
    try {
      const activeRaffles = await getActiveRaffles();
      const details = await Promise.all(
        activeRaffles.map(async (addr) => {
          const info = await getRaffleInfo(addr as Address);
          const meta = getRaffleMeta(addr as string);
          return {
            address: info.address,
            state: RaffleState[info.state],
            totalPool: formatEther(info.totalPool),
            participants: info.participantCount.toString(),
            closesAt: new Date(
              Number(info.closesAt) * 1000
            ).toISOString(),
            name: meta?.name || null,
            type: meta?.type || null,
            coverImage: meta?.coverImage || null,
          };
        })
      );
      return c.json({ raffles: details });
    } catch (error) {
      return c.json(
        { error: "Failed to fetch raffles", details: String(error) },
        500
      );
    }
  });

  app.get("/api/raffles/current", async (c) => {
    const vault = getCurrentVault();
    if (!vault) {
      return c.json({ current: null, message: "No active house raffle" });
    }

    try {
      const info = await getRaffleInfo(vault);
      const meta = getRaffleMeta(vault);
      return c.json({
        current: {
          address: info.address,
          state: RaffleState[info.state],
          totalPool: formatEther(info.totalPool),
          participants: info.participantCount.toString(),
          closesAt: new Date(Number(info.closesAt) * 1000).toISOString(),
          ticketPrice: formatEther(config.raffle.ticketPrice),
          name: meta?.name || config.raffle.name,
          type: meta?.type || "house",
          coverImage: meta?.coverImage || null,
        },
      });
    } catch (error) {
      return c.json(
        { error: "Failed to read vault", details: String(error) },
        500
      );
    }
  });

  app.get("/api/raffles/:address", async (c) => {
    const address = c.req.param("address") as Address;
    try {
      const info = await getRaffleInfo(address);
      return c.json({
        address: info.address,
        state: RaffleState[info.state],
        totalPool: formatEther(info.totalPool),
        participants: info.participantCount.toString(),
        closesAt: new Date(Number(info.closesAt) * 1000).toISOString(),
      });
    } catch (error) {
      return c.json(
        { error: "Invalid raffle address", details: String(error) },
        500
      );
    }
  });

  // ============ Raffle metadata ============

  app.get("/api/raffles/:address/meta", async (c) => {
    const address = c.req.param("address");
    const meta = getRaffleMeta(address);
    if (!meta) {
      return c.json({ error: "No metadata for this raffle" }, 404);
    }
    return c.json(meta);
  });

  app.get("/api/meta/raffles", async (c) => {
    const type = c.req.query("type"); // ?type=house or ?type=community
    let metas = getAllRaffleMeta();
    if (type === "house" || type === "community") {
      metas = metas.filter((m) => m.type === type);
    }
    return c.json({ raffles: metas });
  });

  // ============ Agent info ============

  app.get("/api/agents/total", async (c) => {
    try {
      const total = await publicClient.readContract({
        address: config.contracts.agentRegistry,
        abi: AgentRegistryAbi,
        functionName: "totalAgents",
      });
      return c.json({ totalAgents: (total as bigint).toString() });
    } catch (error) {
      return c.json(
        { error: "Failed to read agent registry", details: String(error) },
        500
      );
    }
  });

  app.get("/api/agents/:address/status", async (c) => {
    const address = c.req.param("address") as Address;
    try {
      const [registered, suspended] = await Promise.all([
        publicClient.readContract({
          address: config.contracts.agentRegistry,
          abi: AgentRegistryAbi,
          functionName: "isRegistered",
          args: [address],
        }),
        publicClient.readContract({
          address: config.contracts.agentRegistry,
          abi: AgentRegistryAbi,
          functionName: "isSuspended",
          args: [address],
        }),
      ]);
      return c.json({
        address,
        registered: registered as boolean,
        suspended: suspended as boolean,
      });
    } catch (error) {
      return c.json(
        { error: "Failed to read agent status", details: String(error) },
        500
      );
    }
  });

  // ============ Entry guide ============

  app.get("/api/raffles/:address/entry-info", async (c) => {
    const address = c.req.param("address") as Address;
    return c.json({
      vault: address,
      instructions: {
        option1: {
          name: "Direct on-chain entry",
          step1:
            "Approve the vault to spend your payment token: paymentToken.approve(vault, ticketPrice)",
          step2:
            "Call enterRaffle(beneficiaryVote) on the vault to enter directly",
        },
        option2: {
          name: "x402 HTTP payment (recommended for agents)",
          description:
            "POST to /api/raffles/:address/enter with x402 payment. The house agent enters on your behalf.",
          step1:
            "POST /api/raffles/:address/enter with body { beneficiaryVote: '0x...' }",
          step2:
            "Include x402 payment header — server returns 402 with payment requirements on first call",
        },
      },
      contracts: {
        vault: address,
        paymentToken: config.contracts.paymentToken,
      },
      ticketPrice: config.raffle.ticketPrice.toString(),
    });
  });

  // ============ Agent-friendly HTML pages ============
  // Plain HTML, no JS required — agents can fetch and parse these directly.

  app.get("/", async (c) => {
    const accept = c.req.header("accept") || "";
    if (accept.includes("application/json")) {
      return c.json({
        name: "RaffleTime",
        description: "Zero-loss agentic raffle platform on Celo",
        links: {
          raffles: "/raffles",
          api: "/api/raffles",
          agent_json: "/.well-known/agent.json",
          health: "/api/health",
        },
      });
    }

    let raffleListHtml = "";
    try {
      const activeRaffles = await getActiveRaffles();
      if (activeRaffles.length === 0) {
        raffleListHtml = "<p>No active raffles right now. Check back soon.</p>";
      } else {
        const items = await Promise.all(
          activeRaffles.map(async (addr) => {
            const info = await getRaffleInfo(addr as Address);
            const meta = getRaffleMeta(addr as string);
            const remaining = Number(info.closesAt) - Math.floor(Date.now() / 1000);
            const timeStr = remaining > 0 ? `${Math.floor(remaining / 60)}m ${remaining % 60}s` : "CLOSED";
            const displayName = meta?.name || info.address.slice(0, 10) + "...";
            const typeLabel = meta?.type === "community" ? "Community" : "House";
            return `<li>
              <a href="/raffles/${info.address}"><strong>${displayName}</strong></a>
              <span>[${typeLabel} Raffle]</span> —
              ${RaffleState[info.state]} |
              Pool: $${formatEther(info.totalPool)} |
              ${info.participantCount.toString()} participants |
              ${timeStr} remaining
            </li>`;
          })
        );
        raffleListHtml = `<ul>${items.join("\n")}</ul>`;
      }
    } catch {
      raffleListHtml = "<p>Failed to load raffles.</p>";
    }

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RaffleTime — Zero-Loss Agentic Raffles</title>
  <meta name="description" content="Provably fair onchain raffles operated by AI agents on Celo.">
</head>
<body>
  <h1>RaffleTime</h1>
  <p>Zero-loss agentic raffle platform on Celo. Provably fair, fully onchain.</p>

  <h2>Active Raffles</h2>
  ${raffleListHtml}

  <h2>For Agents</h2>
  <ul>
    <li><a href="/.well-known/agent.json">Agent Discovery (ERC-8004)</a> — machine-readable agent metadata</li>
    <li><a href="/api/raffles">GET /api/raffles</a> — JSON list of active raffles</li>
    <li><a href="/api/raffles/current">GET /api/raffles/current</a> — current house raffle</li>
    <li>POST /api/raffles/{address}/enter — enter via x402 payment (HTTP 402 flow)</li>
  </ul>

  <h2>How to Enter (Agents)</h2>
  <ol>
    <li><strong>Register:</strong> Call <code>AgentRegistry.registerAgent(uri, bondAmount)</code> on-chain (one-time setup, requires $1 bond).</li>
    <li><strong>Find a raffle:</strong> <code>GET /api/raffles/current</code> to get the active vault address.</li>
    <li><strong>Enter via x402:</strong> <code>POST /api/raffles/{vault}/enter</code> with body <code>{"beneficiaryVote": "0x..."}</code>. If x402 is enabled, the server responds with HTTP 402 and payment requirements. Pay via x402 header and retry.</li>
    <li><strong>Or enter directly:</strong> Approve payment token to the vault, then call <code>enterRaffle(beneficiaryVote)</code> on-chain.</li>
  </ol>

  <h2>Contracts</h2>
  <table>
    <tr><td>Factory</td><td><code>${config.contracts.factory}</code></td></tr>
    <tr><td>Registry</td><td><code>${config.contracts.registry}</code></td></tr>
    <tr><td>Agent Registry</td><td><code>${config.contracts.agentRegistry}</code></td></tr>
    <tr><td>Payment Token</td><td><code>${config.contracts.paymentToken}</code></td></tr>
    <tr><td>Chain</td><td>Celo (${config.chainId})</td></tr>
  </table>
</body>
</html>`);
  });

  app.get("/raffles", async (c) => {
    // Redirect to home — raffles are listed there
    return c.redirect("/");
  });

  app.get("/raffles/:address", async (c) => {
    const address = c.req.param("address") as Address;

    const accept = c.req.header("accept") || "";
    if (accept.includes("application/json")) {
      // Serve JSON if requested
      return c.redirect(`/api/raffles/${address}`);
    }

    try {
      const info = await getRaffleInfo(address);
      const meta = getRaffleMeta(address);
      const remaining = Number(info.closesAt) - Math.floor(Date.now() / 1000);
      const timeStr = remaining > 0 ? `${Math.floor(remaining / 60)}m ${remaining % 60}s remaining` : "ENDED";
      const stateStr = RaffleState[info.state];
      const displayName = meta?.name || address.slice(0, 10) + "...";
      const typeLabel = meta?.type === "community" ? "Community Raffle" : "House Raffle";

      let actionHtml = "";
      if (info.state === RaffleState.OPEN) {
        actionHtml = `
          <h2>Enter This Raffle</h2>
          <h3>Option 1: x402 Payment (recommended for agents)</h3>
          <pre>POST /api/raffles/${address}/enter
Content-Type: application/json

{"beneficiaryVote": "0x..."}</pre>
          <p>The server will respond with HTTP 402 and payment requirements. Include the x402 payment header and retry.</p>

          <h3>Option 2: Direct On-Chain</h3>
          <ol>
            <li>Approve payment token: <code>paymentToken.approve(${address}, ${config.raffle.ticketPrice.toString()})</code></li>
            <li>Enter: <code>vault.enterRaffle(beneficiaryVote)</code></li>
          </ol>`;
      } else if (info.state === RaffleState.SETTLED) {
        actionHtml = `<h2>Results</h2><p>This raffle has been settled. Winners have been paid.</p>`;
      } else {
        actionHtml = `<p>This raffle is currently in <strong>${stateStr}</strong> state.</p>`;
      }

      return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${displayName} — RaffleTime</title>
</head>
<body>
  <p><a href="/">← Back to RaffleTime</a></p>
  <h1>${displayName}</h1>
  <p><em>${typeLabel}</em></p>${meta?.coverImage ? `\n  <img src="${meta.coverImage}" alt="${displayName}" style="max-width:400px">` : ""}

  <table>
    <tr><td>Status</td><td><strong>${stateStr}</strong></td></tr>
    <tr><td>Pool</td><td>$${formatEther(info.totalPool)}</td></tr>
    <tr><td>Participants</td><td>${info.participantCount.toString()}</td></tr>
    <tr><td>Ticket Price</td><td>$${formatEther(config.raffle.ticketPrice)}</td></tr>
    <tr><td>Time</td><td>${timeStr}</td></tr>
    <tr><td>Vault Address</td><td><code>${address}</code></td></tr>
    <tr><td>Payment Token</td><td><code>${config.contracts.paymentToken}</code></td></tr>
  </table>

  ${actionHtml}

  <h2>API</h2>
  <ul>
    <li><a href="/api/raffles/${address}">JSON details</a></li>
    <li><a href="/api/raffles/${address}/entry-info">Entry instructions (JSON)</a></li>
  </ul>
</body>
</html>`);
    } catch (error) {
      return c.html(`<!DOCTYPE html>
<html><body>
  <p><a href="/">← Back</a></p>
  <h1>Raffle Not Found</h1>
  <p>Could not load raffle at ${address}: ${String(error)}</p>
</body></html>`, 404);
    }
  });

  // ============ x402-gated raffle entry ============

  app.post("/api/raffles/:address/enter", async (c) => {
      const vaultAddress = c.req.param("address") as Address;

      // Parse beneficiary vote from request body
      let beneficiaryVote: Address;
      try {
        const body = await c.req.json();
        beneficiaryVote = body.beneficiaryVote as Address;
        if (!beneficiaryVote) {
          return c.json(
            { error: "beneficiaryVote address is required in request body" },
            400
          );
        }
      } catch {
        return c.json(
          {
            error: "Invalid JSON body. Expected: { beneficiaryVote: '0x...' }",
          },
          400
        );
      }

      // Verify raffle is OPEN
      try {
        const info = await getRaffleInfo(vaultAddress);
        if (info.state !== RaffleState.OPEN) {
          return c.json(
            {
              error: `Raffle is not open (current state: ${RaffleState[info.state]})`,
            },
            409
          );
        }
      } catch (error) {
        return c.json(
          { error: "Invalid raffle address", details: String(error) },
          400
        );
      }

      // House agent submits entry on-chain on behalf of the x402 payer.
      // The payment was already settled via x402 — the house agent received
      // the ticket price. Now approve the vault and enter.
      try {
        const wallet = getWalletClient();
        const agentAddress = getAgentAddress();

        // Step 1: Approve vault to spend the ticket price from house agent
        const approveHash = await wallet.writeContract({
          address: config.contracts.paymentToken,
          abi: ERC20Abi,
          functionName: "approve",
          args: [vaultAddress, config.raffle.ticketPrice],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Step 2: Enter raffle on behalf of payer
        const enterHash = await wallet.writeContract({
          address: vaultAddress,
          abi: RaffleVaultAbi,
          functionName: "enterRaffle",
          args: [beneficiaryVote],
        } as any);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: enterHash,
        });

        return c.json({
          success: true,
          message: "Raffle entry submitted via x402 payment",
          vault: vaultAddress,
          enteredBy: agentAddress,
          beneficiaryVote,
          transactionHash: receipt.transactionHash,
        });
      } catch (error) {
        return c.json(
          { error: "Failed to submit raffle entry", details: String(error) },
          500
        );
      }
    }
  );

  return app;
}
