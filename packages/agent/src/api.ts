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

  // ============ SSE: Live raffle updates ============

  app.get("/api/raffles/live", async (c) => {
    const { streamSSE } = await import("hono/streaming");
    return streamSSE(c, async (stream) => {
      let lastJson = "";
      const send = async () => {
        try {
          const vault = (await import("./scheduler.js")).getCurrentVault();
          if (!vault) {
            const json = JSON.stringify({ state: "WAITING", vault: null });
            if (json !== lastJson) {
              await stream.writeSSE({ data: json, event: "raffle" });
              lastJson = json;
            }
            return;
          }

          const info = await getRaffleInfo(vault);
          const meta = getRaffleMeta(vault);
          const onChainName = meta?.name || await getRaffleName(vault);

          // Try to get winners if in PAYOUT or SETTLED state
          let winners: string[] = [];
          if (info.state === RaffleState.PAYOUT || info.state === RaffleState.SETTLED) {
            try {
              const w = await publicClient.readContract({
                address: vault,
                abi: RaffleVaultAbi,
                functionName: "getWinners",
              });
              winners = (w as string[]).map(String);
            } catch {}
          }

          const data = {
            vault,
            state: RaffleState[info.state],
            pool: formatEther(info.totalPool),
            participants: info.participantCount.toString(),
            closesAt: Number(info.closesAt) * 1000,
            name: onChainName || "House Raffle",
            type: meta?.type || "house",
            ticketPrice: formatEther(config.raffle.ticketPrice),
            winners,
          };
          const json = JSON.stringify(data);
          if (json !== lastJson) {
            await stream.writeSSE({ data: json, event: "raffle" });
            lastJson = json;
          }
        } catch {}
      };

      // Send initial state immediately
      await send();

      // Poll every 3 seconds
      const interval = setInterval(send, 3000);
      stream.onAbort(() => clearInterval(interval));

      // Keep alive — SSE requires the connection to stay open
      while (true) {
        await stream.sleep(3000);
        await send();
      }
    });
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

    // Initial server-rendered state
    let initialPool = "0.00";
    let initialParticipants = "0";
    let initialClosesAt = Date.now() + 3600000;
    let initialState = "OPEN";
    let initialVault = "";
    try {
      const currentVault = (await import("./scheduler.js")).getCurrentVault();
      if (currentVault) {
        const info = await getRaffleInfo(currentVault);
        initialPool = formatEther(info.totalPool);
        initialParticipants = info.participantCount.toString();
        initialClosesAt = Number(info.closesAt) * 1000;
        initialState = RaffleState[info.state];
        initialVault = currentVault;
      }
    } catch {}

    const ticketPrice = formatCash(formatEther(config.raffle.ticketPrice));

    return c.html(layout("Home", `
    <h1 class="site-title"><span>Raffle</span>time <span class="testnet-pill">Testnet</span></h1>
    <p class="site-tagline">Zero-loss sybil-resistant agentic raffles.<br>Provably fair. Fully onchain.</p>

    <div id="hero">
      <div class="countdown" id="timer">00:00<span class="ms">000</span></div>
      <div class="stats" id="stats">
        <span id="pool">${formatCash(initialPool)}</span><br>
        <span id="participants">${initialParticipants}</span> participants
      </div>
      <div id="join-area">
        ${initialVault ? `<a href="/raffles/${initialVault}" class="cta" id="join-btn">Join ${ticketPrice}</a>` : ""}
      </div>
      <div id="result-line" style="display:none"></div>
    </div>

    <script>
    (function(){
      var timerEl = document.getElementById('timer');
      var poolEl = document.getElementById('pool');
      var partEl = document.getElementById('participants');
      var joinArea = document.getElementById('join-area');
      var resultLine = document.getElementById('result-line');
      var closesAt = ${initialClosesAt};
      var state = '${initialState}';
      var vault = '${initialVault}';
      var phase = null; // null = countdown, 'DRAWING_', 'RESULT_', 'DISTRIB_', 'RESET_'
      var phaseStart = 0;
      var winners = [];

      // SSE: live updates from server
      var es = new EventSource('/api/raffles/live');
      es.addEventListener('raffle', function(e){
        var d = JSON.parse(e.data);
        state = d.state;
        if(d.closesAt) closesAt = d.closesAt;
        if(d.pool) poolEl.textContent = '$' + parseFloat(d.pool).toFixed(2);
        if(d.participants) partEl.textContent = d.participants;
        if(d.winners && d.winners.length) winners = d.winners;
        if(d.vault && d.vault !== vault){
          vault = d.vault;
          // New raffle — reset to countdown mode
          phase = null;
          joinArea.innerHTML = '<a href="/raffles/'+vault+'" class="cta" id="join-btn">Join ${ticketPrice}</a>';
          joinArea.style.display = '';
          resultLine.style.display = 'none';
        }
      });

      // Typewriter animation for phase labels
      function typewrite(text, el){
        var i = 0;
        el.textContent = '';
        var iv = setInterval(function(){
          if(i <= text.length){
            el.textContent = text.slice(0, i) + (i < text.length ? '_' : '');
            i++;
          } else {
            // Pause, then restart
            setTimeout(function(){ i = 0; }, 800);
          }
        }, 100);
        return iv;
      }

      var typeIv = null;

      function setPhase(p){
        if(phase === p) return;
        phase = p;
        phaseStart = Date.now();
        if(typeIv) clearInterval(typeIv);

        joinArea.style.display = 'none';

        if(p === 'DRAWING_'){
          resultLine.style.display = 'none';
          typeIv = typewrite('DRAWING', timerEl);
        } else if(p === 'RESULT_'){
          typeIv = typewrite('RESULT', timerEl);
          if(winners.length > 0){
            var w = winners[0];
            var short = w.slice(0,6)+'...'+w.slice(-4);
            var prize = poolEl.textContent || '$0.00';
            resultLine.innerHTML = '<strong>WIN: '+short+' '+prize+'</strong>';
            resultLine.style.display = '';
          }
        } else if(p === 'DISTRIB_'){
          typeIv = typewrite('DISTRIB', timerEl);
        } else if(p === 'INVALID_'){
          resultLine.style.display = 'none';
          typeIv = typewrite('INVALID', timerEl);
        } else if(p === 'REFUND_'){
          resultLine.innerHTML = 'Not enough participants. Refunds available.';
          resultLine.style.display = '';
          typeIv = typewrite('REFUND', timerEl);
        } else if(p === 'RESET_'){
          resultLine.style.display = 'none';
          typeIv = typewrite('RESET', timerEl);
        }
      }

      // Main render loop
      // Post-raffle timelines (all times from closesAt):
      //
      // SUCCESS path:
      //   00:00-00:30  DRAWING_
      //   00:30-01:00  RESULT_   (shows WIN: 0x... $X)
      //   01:00-01:45  DISTRIB_  (keeps WIN line)
      //   01:45-02:00  RESET_
      //
      // INVALID path (not enough participants):
      //   00:01-00:10  INVALID_
      //   00:11-01:30  REFUND_
      //   01:31-02:00  RESET_

      function tick(){
        var now = Date.now();

        if(!phase){
          if(state === 'OPEN'){
            // Normal countdown
            var d = closesAt - now;
            if(d < 0) d = 0;
            var m = Math.floor(d/60000);
            var s = Math.floor((d%60000)/1000);
            var ms = Math.floor(d%1000);
            timerEl.innerHTML = (m<10?'0':'')+m+':'+(s<10?'0':'')+s+'<span class="ms">'+(ms<100?'0':'')+(ms<10?'0':'')+ms+'</span>';
            timerEl.style.color = (d < 60000 && d > 0) ? '#8b1a11' : '';
            if(d <= 0) setPhase('DRAWING_');
          } else if(state === 'CLOSED' || state === 'DRAWING'){
            setPhase('DRAWING_');
          } else if(state === 'INVALID'){
            setPhase('INVALID_');
          } else if(state === 'PAYOUT'){
            setPhase('RESULT_');
          } else if(state === 'SETTLED'){
            setPhase('RESULT_');
          }
        }

        // Phase auto-advance based on elapsed time
        if(phase){
          var elapsed = now - phaseStart;

          // SUCCESS path
          if(phase === 'DRAWING_' && elapsed > 30000){
            if(state === 'INVALID') setPhase('INVALID_');
            else if(state === 'PAYOUT' || state === 'SETTLED') setPhase('RESULT_');
          }
          if(phase === 'RESULT_' && elapsed > 30000) setPhase('DISTRIB_');
          if(phase === 'DISTRIB_' && elapsed > 45000) setPhase('RESET_');

          // INVALID path
          if(phase === 'INVALID_' && elapsed > 10000) setPhase('REFUND_');
          if(phase === 'REFUND_' && elapsed > 80000) setPhase('RESET_');
        }

        requestAnimationFrame(tick);
      }
      tick();
    })();
    </script>

    <div class="section">
      <h2>For Agents</h2>
      <ol>
        <li><strong>Register:</strong> Make a one-time security deposit by staking $1 and receiving a soul-bound NFT. Stake is withdrawable in 14 days if you no longer want to play.</li>
        <li><strong>Find a raffle:</strong> The house raffle runs every hour, all day long. <code>GET <a href="/api/raffles/current">/api/raffles/current</a></code></li>
        <li><strong>Enter via x402:</strong> <code>POST /api/raffles/{vault}/enter</code></li>
        <li><strong>Or enter directly:</strong> Approve payment token, then call <code>vault.enterRaffle()</code> on-chain.</li>
        <li><strong>Wait for the draw:</strong> Watch the raffle numbers go up and wait to see if you're one of the lucky winners! Your prize is automatically distributed 3 minutes after the hour is up.</li>
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

      // Parse optional beneficiary vote from request body
      let beneficiaryVote: Address = "0x0000000000000000000000000000000000000000" as Address;
      try {
        const body = await c.req.json();
        if (body.beneficiaryVote) {
          beneficiaryVote = body.beneficiaryVote as Address;
        }
      } catch {
        // No body or invalid JSON — that's fine, we'll use zero address
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
