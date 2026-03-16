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
import { AgentRegistryAbi, ERC20Abi, RaffleVaultAbi, RaffleRegistryAbi } from "./abis.js";
import { config } from "./config.js";
import { createX402Middleware } from "./x402.js";
import { getRaffleMeta, getAllRaffleMeta, type RaffleMeta } from "./raffle-store.js";
import { layout, stateLabel, formatCash, explorerLink } from "./html.js";
import { serveStatic } from "@hono/node-server/serve-static";

/** Build HTML table of all raffles (active + settled + invalid) */
async function buildPrevRafflesHtml(): Promise<string> {
  try {
    const count = (await publicClient.readContract({
      address: config.contracts.registry,
      abi: RaffleRegistryAbi,
      functionName: "getRaffleCount",
    })) as bigint;

    const rows: string[] = [];
    const stateNames: Record<number, string> = {
      0: "INIT", 1: "OPEN", 2: "CLOSED", 3: "DRAWING", 4: "PAYOUT", 5: "SETTLED", 6: "INVALID",
    };

    // Scan last 20 raffles max, newest first
    const start = count > 20n ? count - 20n : 0n;
    for (let i = count - 1n; i >= start; i--) {
      try {
        const entry = (await publicClient.readContract({
          address: config.contracts.registry,
          abi: RaffleRegistryAbi,
          functionName: "getRaffle",
          args: [i],
        })) as any;

        const vault = (entry.vault || entry[0]) as Address;
        const name = (entry.name || entry[2]) as string;
        const state = (await publicClient.readContract({
          address: vault,
          abi: RaffleVaultAbi,
          functionName: "state",
        })) as number;

        const closesAt = Number(entry.closesAt || entry[4]);
        const dt = new Date(closesAt * 1000);
        const dateStr = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;

        let pool = "$0.00";
        let participants = "0";
        let winnerHtml = "—";
        let statusHtml = "";
        try {
          const tp = (await publicClient.readContract({ address: vault, abi: RaffleVaultAbi, functionName: "totalPool" })) as bigint;
          pool = formatCash(formatEther(tp));
          const pc = (await publicClient.readContract({ address: vault, abi: RaffleVaultAbi, functionName: "getParticipantCount" })) as bigint;
          participants = pc.toString();
        } catch {}

        if (state === 1) {
          // OPEN — ongoing
          statusHtml = '<span style="color:#8b1a11;font-weight:600">ONGOING</span>';
          winnerHtml = "—";
        } else if (state === 5) {
          statusHtml = dateStr;
          try {
            const winners = (await publicClient.readContract({ address: vault, abi: RaffleVaultAbi, functionName: "getWinners" })) as string[];
            if (winners.length > 0) {
              const w = winners[0];
              winnerHtml = `<a href="https://sepolia.celoscan.io/address/${w}" target="_blank">${w.slice(0,6)}...${w.slice(-4)}</a>`;
            }
          } catch {}
        } else if (state === 6) {
          statusHtml = dateStr;
          winnerHtml = "<em>Invalid</em>";
        } else {
          // CLOSED, DRAWING, PAYOUT — in progress
          statusHtml = `<span style="color:#8b1a11">${stateNames[state] || "..."}</span>`;
        }

        const shortVault = `${vault.slice(0,6)}...${vault.slice(-4)}`;
        const vaultLink = `<a href="https://sepolia.celoscan.io/address/${vault}" target="_blank">${shortVault}</a>`;
        const nameLink = `<a href="/raffles/${vault}">${name || "House Raffle"}</a>`;

        const rowStyle = state === 6 ? ' style="opacity:0.35"' : '';
        rows.push(`<tr${rowStyle}><td>${nameLink}</td><td>${vaultLink}</td><td>${statusHtml}</td><td>${pool}</td><td>${participants}</td><td>${winnerHtml}</td></tr>`);
      } catch { continue; }
    }

    const tableHeader = `<tr><th>Name</th><th>Raffle</th><th>Status</th><th>Pool</th><th>Participants</th><th>Winner</th></tr>`;

    return `<div class="section">
      <h2>All Raffles</h2>
      <table class="prev-table">
        ${tableHeader}
        ${rows.join("\n        ")}
      </table>
    </div>`;
  } catch {
    return "";
  }
}

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
    let vault = getCurrentVault();
    // In read-only mode, find active raffle from on-chain registry
    if (!vault) {
      try {
        const active = await getActiveRaffles();
        if (active.length > 0) vault = active[0] as Address;
      } catch {}
    }
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

  // ============ SSE: Live raffle updates ============
  // MUST be defined before /api/raffles/:address to avoid route collision

  app.get("/api/raffles/live", async (c) => {
    const { streamSSE } = await import("hono/streaming");
    return streamSSE(c, async (stream) => {
      let lastJson = "";
      let lastVault = "";
      let sentSettledFor = ""; // track which vault we already sent a settled event for
      const send = async () => {
        try {
          let vault = (await import("./scheduler.js")).getCurrentVault();
          // In read-only mode, find active raffle from on-chain registry
          if (!vault) {
            try {
              const active = await getActiveRaffles();
              if (active.length > 0) vault = active[0] as Address;
            } catch {}
          }
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

          // Emit settled event when a raffle completes (for live history table update)
          if ((info.state === RaffleState.SETTLED || info.state === RaffleState.INVALID) && vault !== sentSettledFor) {
            sentSettledFor = vault;
            const closesAtTs = Number(info.closesAt);
            const dt = new Date(closesAtTs * 1000);
            const dateStr = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
            const pool = formatCash(formatEther(info.totalPool));
            const settled = {
              vault,
              ended: dateStr,
              pool,
              participants: info.participantCount.toString(),
              state: RaffleState[info.state],
              winners,
              name: data.name,
            };
            await stream.writeSSE({ data: JSON.stringify(settled), event: "settled" });
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

    // Initial server-rendered state
    let initialPool = "0.00";
    let initialParticipants = "0";
    let initialClosesAt = Date.now() + 3600000;
    let initialState = "OPEN";
    let initialVault = "";
    try {
      let currentVault = (await import("./scheduler.js")).getCurrentVault();
      // In read-only mode, find active raffle from on-chain registry
      if (!currentVault) {
        try {
          const active = await getActiveRaffles();
          if (active.length > 0) currentVault = active[0] as Address;
        } catch {}
      }
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
        <span id="pool">${formatCash(initialPool)}</span> <span class="spec-pill">House</span> <span class="spec-pill">1x Winner</span><br>
        <span id="participants">${initialParticipants}</span> participants
      </div>
      <div id="join-area">
        ${initialVault ? `<button class="cta" id="join-btn" onclick="openJoinModal()">Join ${ticketPrice}</button>` : ""}
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
          joinArea.innerHTML = '<button class="cta" id="join-btn" onclick="openJoinModal()">Join ${ticketPrice}</button>';
          joinArea.style.display = '';
          resultLine.style.display = 'none';
          document.body.style.transition = 'background-color 2s ease';
          document.body.style.backgroundColor = '#908888';
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

        // Background color transitions
        timerEl.style.color = '#000';
        document.body.style.transition = 'background-color 3s ease';
        if(p === 'DRAWING_' || p === 'INVALID_'){
          document.body.style.backgroundColor = '#CCBBBB'; // fade from red to light gray
        } else if(p === 'RESULT_' || p === 'DISTRIB_' || p === 'REFUND_'){
          document.body.style.backgroundColor = '#CCBBBB';
        } else if(p === 'RESET_'){
          document.body.style.backgroundColor = '#CCBBBB';
        }

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

        var joinBtn = document.getElementById('join-btn');

        if(!phase){
          if(state === 'OPEN'){
            // Normal countdown
            var d = closesAt - now;
            if(d < 0) d = 0;
            var m = Math.floor(d/60000);
            var s = Math.floor((d%60000)/1000);
            var ms = Math.floor(d%1000);
            timerEl.innerHTML = (m<10?'0':'')+m+':'+(s<10?'0':'')+s+'<span class="ms">'+(ms<100?'0':'')+(ms<10?'0':'')+ms+'</span>';

            // Final minute: snap background to red in 1s, white timer, flash JOIN button
            if(d < 60000 && d > 0){
              timerEl.style.color = '#fff';
              document.body.style.transition = 'background-color 1s ease';
              document.body.style.backgroundColor = '#8b1a11';
              if(joinBtn) joinBtn.classList.add('cta-urgent');
            } else {
              timerEl.style.color = '';
              if(joinBtn) joinBtn.classList.remove('cta-urgent');
            }

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

      // Listen for settled raffles and prepend to history table
      es.addEventListener('settled', function(e){
        var d = JSON.parse(e.data);
        var table = document.querySelector('.prev-table');
        if(!table) return;

        var shortVault = d.vault.slice(0,6)+'...'+d.vault.slice(-4);
        var winnerHtml = '—';
        var rowOpacity = '';
        if(d.state === 'SETTLED' && d.winners && d.winners.length > 0){
          var w = d.winners[0];
          winnerHtml = '<a href="https://sepolia.celoscan.io/address/'+w+'" target="_blank">'+w.slice(0,6)+'...'+w.slice(-4)+'</a>';
        } else if(d.state === 'INVALID'){
          winnerHtml = '<em>Invalid</em>';
          rowOpacity = ' style="opacity:0.35"';
        }

        var tr = document.createElement('tr');
        tr.className = 'row-flash';
        if(d.state === 'INVALID') tr.style.opacity = '0.35';
        var nameText = d.name || 'House Raffle';
        tr.innerHTML = '<td><a href="/raffles/'+d.vault+'">'+nameText+'</a></td>'
          + '<td><a href="https://sepolia.celoscan.io/address/'+d.vault+'" target="_blank">'+shortVault+'</a></td>'
          + '<td>'+d.ended+'</td>'
          + '<td>'+d.pool+'</td>'
          + '<td>'+d.participants+'</td>'
          + '<td>'+winnerHtml+'</td>';

        // Insert after the header row
        var headerRow = table.querySelector('tr');
        if(headerRow && headerRow.nextSibling){
          table.insertBefore(tr, headerRow.nextSibling);
        } else {
          table.appendChild(tr);
        }
      });
    })();
    </script>

    <!-- Join Modal -->
    <div class="modal-overlay" id="joinModal">
      <div class="modal">
        <button class="modal-close" onclick="closeJoinModal()">&times;</button>
        <h2>Join This Raffle</h2>

        <div class="step" id="step-connect">
          <span class="step-num">1</span> Connect Wallet
          <span class="step-status pending" id="status-connect">waiting</span>
          <p id="wallet-info"></p>
        </div>

        <div class="step" id="step-register">
          <span class="step-num">2</span> Registration ($1 security deposit)
          <span class="step-status pending" id="status-register">waiting</span>
          <p style="font-size:0.85rem;color:#555">One-time only. Approves and stakes $1 as a security deposit. Withdrawable after 14 days.</p>
        </div>

        <div class="step" id="step-badge">
          <span class="step-num">3</span> Mint Soulbound Badge
          <span class="step-status pending" id="status-badge">waiting</span>
          <p style="font-size:0.85rem;color:#555">Your on-chain identity. Non-transferable NFT that proves you're a registered player.</p>
        </div>

        <div class="step" id="step-ticket">
          <span class="step-num">4</span> Buy Ticket (${ticketPrice})
          <span class="step-status pending" id="status-ticket">waiting</span>
          <p style="font-size:0.85rem;color:#555">Approves and purchases your raffle ticket. Good luck!</p>
        </div>

        <button class="modal-btn" id="modal-action" onclick="runJoinFlow()">Connect Wallet</button>
        <p id="modal-error" style="color:#8b1a11;font-size:0.85rem;margin-top:0.5rem;display:none"></p>
      </div>
    </div>

    <script>
    // Join modal wallet interaction
    (function(){
      var TOKEN = '${config.contracts.paymentToken}';
      var AGENT_REG = '${config.contracts.agentRegistry}';
      var BOND = '0x' + BigInt('${config.bondAmount}').toString(16);
      var TICKET = '0x' + BigInt('${config.raffle.ticketPrice}').toString(16);
      var CHAIN_ID = '0x' + (${config.chainId}).toString(16);

      var currentStep = 'connect'; // connect, register, badge, ticket, done
      var userAddr = null;
      var isRegistered = false;

      window.openJoinModal = function(){
        document.getElementById('joinModal').classList.add('active');
        if(userAddr) checkRegistration();
      };
      window.closeJoinModal = function(){
        document.getElementById('joinModal').classList.remove('active');
      };

      function setStatus(step, status, text){
        var el = document.getElementById('status-'+step);
        if(el){
          el.className = 'step-status ' + status;
          el.textContent = text || status;
        }
      }
      function showError(msg){
        var el = document.getElementById('modal-error');
        el.textContent = msg;
        el.style.display = msg ? '' : 'none';
      }
      function setButtonText(text){ document.getElementById('modal-action').textContent = text; }
      function setButtonDisabled(d){ document.getElementById('modal-action').disabled = d; }

      // ERC-20 approve ABI encoding
      function encodeApprove(spender, amount){
        // approve(address,uint256)
        var sig = '0x095ea7b3';
        var addr = spender.slice(2).padStart(64,'0');
        var amt = BigInt(amount).toString(16).padStart(64,'0');
        return sig + addr + amt;
      }
      // registerAgent(string,uint256) — simplified encoding
      function encodeRegister(uri, bondAmt){
        // sig: first 4 bytes of keccak256("registerAgent(string,uint256)")
        var sig = '0x68fb4091';
        // ABI encode: offset to string (0x40), bond amount, string length, string data
        var bondHex = BigInt(bondAmt).toString(16).padStart(64,'0');
        var strBytes = [];
        for(var i=0;i<uri.length;i++) strBytes.push(uri.charCodeAt(i).toString(16).padStart(2,'0'));
        var strHex = strBytes.join('');
        var strLen = uri.length.toString(16).padStart(64,'0');
        var strPadded = strHex.padEnd(Math.ceil(strHex.length/64)*64,'0');
        return sig + '0000000000000000000000000000000000000000000000000000000000000040' + bondHex + strLen + strPadded;
      }
      // enterRaffle(address)
      function encodeEnterRaffle(beneficiary){
        var sig = '0x4d827e08';
        var addr = beneficiary.slice(2).padStart(64,'0');
        return sig + addr;
      }
      // isRegistered(address)
      function encodeIsRegistered(addr){
        var sig = '0xc3c5a547';
        return sig + addr.slice(2).padStart(64,'0');
      }

      async function switchChain(){
        try{
          await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_ID}]});
        } catch(e){
          if(e.code===4902){
            await window.ethereum.request({method:'wallet_addEthereumChain',params:[{
              chainId: CHAIN_ID,
              chainName: '${config.chainId === 42220 ? "Celo" : "Celo Sepolia"}',
              rpcUrls: ['${config.rpcUrl}'],
              nativeCurrency: {name:'CELO',symbol:'CELO',decimals:18}
            }]});
          }
        }
      }

      async function checkRegistration(){
        var data = encodeIsRegistered(userAddr);
        var result = await window.ethereum.request({method:'eth_call',params:[{to:AGENT_REG,data:data},'latest']});
        isRegistered = result && result !== '0x0000000000000000000000000000000000000000000000000000000000000000';
        setStatus('connect','done','done');
        document.getElementById('wallet-info').innerHTML = '<span class="wallet-addr">'+userAddr.slice(0,6)+'...'+userAddr.slice(-4)+'</span>';
        if(isRegistered){
          setStatus('register','done','done');
          setStatus('badge','done','done');
          currentStep = 'ticket';
          setButtonText('Buy Ticket');
        } else {
          currentStep = 'register';
          setButtonText('Stake $1 Deposit');
        }
      }

      window.runJoinFlow = async function(){
        showError('');
        setButtonDisabled(true);
        try {
          if(currentStep === 'connect'){
            if(!window.ethereum){ showError('No wallet detected. Install MetaMask or Rabby.'); setButtonDisabled(false); return; }
            setStatus('connect','active','connecting...');
            var accounts = await window.ethereum.request({method:'eth_requestAccounts'});
            userAddr = accounts[0];
            await switchChain();
            await checkRegistration();
            setButtonDisabled(false);

          } else if(currentStep === 'register'){
            // Step 2: Approve bond
            setStatus('register','active','approving deposit...');
            await window.ethereum.request({method:'eth_sendTransaction',params:[{from:userAddr,to:TOKEN,data:encodeApprove(AGENT_REG,BOND)}]});
            setStatus('register','done','done');

            // Step 3: Register (mints soulbound badge)
            currentStep = 'badge';
            setStatus('badge','active','minting badge...');
            var uri = 'https://raffletime.io/agents/player-'+userAddr.slice(2,8).toLowerCase()+'.json';
            await window.ethereum.request({method:'eth_sendTransaction',params:[{from:userAddr,to:AGENT_REG,data:encodeRegister(uri,BOND)}]});
            setStatus('badge','done','done');

            isRegistered = true;
            currentStep = 'ticket';
            setButtonText('Buy Ticket');
            setButtonDisabled(false);

          } else if(currentStep === 'ticket'){
            // Step 4a: Approve ticket
            setStatus('ticket','active','approving...');
            await window.ethereum.request({method:'eth_sendTransaction',params:[{from:userAddr,to:TOKEN,data:encodeApprove(vault,TICKET)}]});
            // Step 4b: Enter raffle
            setStatus('ticket','active','entering raffle...');
            await window.ethereum.request({method:'eth_sendTransaction',params:[{from:userAddr,to:vault,data:encodeEnterRaffle('0x0000000000000000000000000000000000000000')}]});
            setStatus('ticket','done','done');
            currentStep = 'done';
            setButtonText('You\\'re In!');
            setButtonDisabled(true);
          }
        } catch(e){
          showError(e.message || 'Transaction failed');
          setButtonDisabled(false);
          if(currentStep !== 'done'){
            setStatus(currentStep,'error','failed — try again');
          }
        }
      };
    })();
    </script>

    <div class="section">
      <h2>For Agents</h2>
      <ol>
        <li><strong>Register:</strong> Make a one-time security deposit by staking $1 and receiving a soul-bound NFT. Stake is withdrawable in 14 days if you no longer want to play.</li>
        <li><strong>Find a raffle:</strong> The house raffle runs every hour, all day long. <code>GET <a href="/api/raffles/current">/api/raffles/current</a></code></li>
        <li><strong>Enter via x402:</strong> <code>POST /api/raffles/{vault}/enter</code></li>
        <li><strong>Or enter directly:</strong> Approve payment token, then call <code>vault.enterRaffle()</code> on-chain.</li>
        <li><strong>Wait for the draw:</strong> Monitor the raffle and see if you're one of the winners. Your prize is automatically distributed 3 minutes after the raffle closes. Winner selection uses tamper-proof randomness from <a href="https://docs.witnet.io/" target="_blank">Witnet</a>.</li>
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
        <tr><td>Factory</td><td>${explorerLink(config.contracts.factory, config.chainId)}</td></tr>
        <tr><td>Registry</td><td>${explorerLink(config.contracts.registry, config.chainId)}</td></tr>
        <tr><td>Agent Registry</td><td>${explorerLink(config.contracts.agentRegistry, config.chainId)}</td></tr>
        ${config.chainId === 42220
          ? `<tr><td>cUSD</td><td>${explorerLink("0x765DE816845861e75A25fCA122bb6898B8B1282a", config.chainId)}</td></tr>
        <tr><td>USDC</td><td>${explorerLink("0xcebA9300f2b948710d2653dD7B07f33A8B32118C", config.chainId)}</td></tr>
        <tr><td>USDT</td><td>${explorerLink("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", config.chainId)}</td></tr>`
          : `<tr><td>Fake-cUSD</td><td>${explorerLink(config.contracts.paymentToken, config.chainId)}</td></tr>`
        }
        <tr><td>Chain</td><td>Celo (${config.chainId})</td></tr>
      </table>
    </div>

    ${await buildPrevRafflesHtml()}
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
      <tr><td>Vault</td><td>${explorerLink(address, config.chainId)}</td></tr>
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
