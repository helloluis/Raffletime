import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address, formatEther } from "viem";
import {
  getActiveRaffles,
  getRaffleInfo,
  getRaffleName,
  RaffleState,
} from "./raffle-lifecycle.js";
import { getCurrentVault } from "./scheduler.js";
import { publicClient, getAgentAddress, getWalletClient } from "./chain.js";
import { AgentRegistryAbi, ERC20Abi, RaffleVaultAbi } from "./abis.js";
import { config } from "./config.js";
import { createX402Middleware } from "./x402.js";
import { getRaffleMeta, getAllRaffleMeta, type RaffleMeta } from "./raffle-store.js";
import { layout, stateLabel, formatCash } from "./html.js";
import { serveStatic } from "@hono/node-server/serve-static";

export function createApi(): Hono {
  const app = new Hono();

  app.use("/*", cors());

  // Static files (mascot, images)
  app.use("/images/*", serveStatic({ root: "./public" }));

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

    // Get current house raffle for the hero countdown
    let heroHtml = "";
    try {
      const currentVault = (await import("./scheduler.js")).getCurrentVault();
      const activeRaffles = await getActiveRaffles();

      if (currentVault) {
        const info = await getRaffleInfo(currentVault);
        const meta = getRaffleMeta(currentVault);
        const onChainName = meta?.name || await getRaffleName(currentVault);
        const displayName = onChainName || "House Raffle";
        const pool = parseFloat(formatEther(info.totalPool));
        const closesAtMs = Number(info.closesAt) * 1000;
        const ticketPrice = formatCash(formatEther(config.raffle.ticketPrice));

        heroHtml = `
    <div class="countdown" id="timer">00:00<span class="ms">000</span></div>
    <div class="stats">
      ${formatCash(formatEther(info.totalPool))}<br>
      ${info.participantCount.toString()} tickets
    </div>
    <a href="/raffles/${currentVault}" class="cta">Join ${ticketPrice}</a>
    <script>
      (function(){
        var end = ${closesAtMs};
        var el = document.getElementById('timer');
        function tick(){
          var d = end - Date.now();
          if(d < 0) d = 0;
          var m = Math.floor(d/60000);
          var s = Math.floor((d%60000)/1000);
          var ms = Math.floor(d%1000);
          el.innerHTML = (m<10?'0':'')+m+':'+(s<10?'0':'')+s+'<span class="ms">'+(ms<100?'0':'')+(ms<10?'0':'')+ms+'</span>';
          if(d > 0) requestAnimationFrame(tick);
        }
        tick();
      })();
    </script>`;
      } else {
        heroHtml = `<div class="empty">No active house raffle. Next one starts soon.</div>`;
      }

      // Other raffles section removed — focusing on house raffle hero
    } catch {
      heroHtml = `<div class="empty">Failed to load raffles.</div>`;
    }

    return c.html(layout("Home", `
    <h1 class="site-title"><span>Raffle</span>time</h1>
    <p class="site-tagline">Zero-loss sybil-resistant agentic raffles.<br>Provably fair. Fully onchain.</p>

    ${heroHtml}

    <div class="section">
      <h2>For Agents</h2>
      <ol>
        <li><strong>Register:</strong> Call <code>AgentRegistry.registerAgent(uri, bondAmount)</code> on-chain (one-time, $1 bond).</li>
        <li><strong>Find a raffle:</strong> <code>GET <a href="/api/raffles/current">/api/raffles/current</a></code></li>
        <li><strong>Enter via x402:</strong> <code>POST /api/raffles/{vault}/enter</code> with <code>{"beneficiaryVote": "0x..."}</code></li>
        <li><strong>Or enter directly:</strong> Approve payment token, then <code>vault.enterRaffle(beneficiaryVote)</code> on-chain.</li>
      </ol>
      <p style="margin-top: 0.75rem">
        <a href="/.well-known/agent.json">Agent Discovery (ERC-8004)</a> &middot;
        <a href="/api/raffles">Raffles API</a> &middot;
        <a href="/api/health">Health</a>
      </p>
    </div>

    <div class="section">
      <h2>Contracts</h2>
      <table class="info-table">
        <tr><td>Factory</td><td><code>${config.contracts.factory}</code></td></tr>
        <tr><td>Registry</td><td><code>${config.contracts.registry}</code></td></tr>
        <tr><td>Agent Registry</td><td><code>${config.contracts.agentRegistry}</code></td></tr>
        <tr><td>Payment Token</td><td><code>${config.contracts.paymentToken}</code></td></tr>
        <tr><td>Chain</td><td>Celo (${config.chainId})</td></tr>
      </table>
    </div>
    `));
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
      const onChainName = meta?.name || await getRaffleName(address);
      const displayName = onChainName || address.slice(0, 10) + "...";
      const typeLabel = meta?.type === "community" ? "Community Raffle" : "House Raffle";

      let actionHtml = "";
      if (info.state === RaffleState.OPEN) {
        actionHtml = `
          <div class="section">
            <h2>Enter This Raffle</h2>
            <h3>Option 1: x402 Payment (recommended for agents)</h3>
            <pre><code>POST /api/raffles/${address}/enter
Content-Type: application/json

{"beneficiaryVote": "0x..."}</code></pre>
            <p>The server responds with HTTP 402 and payment requirements. Include the x402 payment header and retry.</p>

            <h3>Option 2: Direct On-Chain</h3>
            <ol>
              <li>Approve payment token: <code>paymentToken.approve(${address}, ${config.raffle.ticketPrice.toString()})</code></li>
              <li>Enter: <code>vault.enterRaffle(beneficiaryVote)</code></li>
            </ol>
          </div>`;
      } else if (info.state === RaffleState.SETTLED) {
        actionHtml = `<div class="section"><h2>Results</h2><p>This raffle has been settled. Winners have been paid.</p></div>`;
      } else {
        actionHtml = `<div class="section"><p>This raffle is currently in ${stateLabel(stateStr)} state.</p></div>`;
      }

      const pool = parseFloat(formatEther(info.totalPool));

      const ticketPrice = formatEther(config.raffle.ticketPrice);

      return c.html(layout(displayName, `
    <a href="/" class="back-link">&larr; Back</a>

    <h1>${displayName}</h1>
    <span class="type-badge ${meta?.type === "community" ? "community" : "house"}">${typeLabel}</span>

    <table class="info-table" style="margin-top: 1.5rem">
      <tr><td>Status</td><td>${stateLabel(stateStr)}</td></tr>
      <tr><td>Pool</td><td>$${pool.toFixed(2)}</td></tr>
      <tr><td>Participants</td><td>${info.participantCount.toString()}</td></tr>
      <tr><td>Ticket Price</td><td>$${ticketPrice}</td></tr>
      <tr><td>Time</td><td>${timeStr}</td></tr>
      <tr><td>Vault</td><td><code>${address}</code></td></tr>
    </table>

    ${info.state === RaffleState.OPEN ? `<p style="margin: 1.5rem 0"><a href="/raffles/${address}" class="cta">Join $${ticketPrice}</a></p>` : ""}

    ${actionHtml}

    <p style="margin-top: 1.5rem">
      <a href="/api/raffles/${address}">JSON details</a> &middot;
      <a href="/api/raffles/${address}/entry-info">Entry instructions</a>
    </p>
    `));
    } catch (error) {
      return c.html(layout("Not Found", `
    <a href="/" class="back-link">&larr; Back to RaffleTime</a>
    <h1>Raffle Not Found</h1>
    <p>Could not load raffle at <code>${address}</code></p>
      `), 404);
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
