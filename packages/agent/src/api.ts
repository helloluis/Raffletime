import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address } from "viem";
import {
  getActiveRaffles,
  getRaffleInfo,
  getRaffleName,
  RaffleState,
} from "./raffle-lifecycle.js";
import { getCurrentVault, getServerPhase } from "./scheduler.js";
import { publicClient, getAgentAddress, getWalletClient } from "./chain.js";
import { AgentRegistryAbi, ERC20Abi, RaffleVaultAbi, RaffleRegistryAbi } from "./abis.js";
import { config } from "./config.js";
import { createX402Middleware } from "./x402.js";
import { getRaffleMeta, getAllRaffleMeta, type RaffleMeta } from "./raffle-store.js";
import { layout, stateLabel, formatCash, formatUsd6, explorerLink, chainLabel, paymentTokenLabel, houseIcon } from "./html.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { buildAgentCard } from "./agent-cards.js";
import * as db from "./db.js";

/** Build HTML table of all raffles (active + settled + invalid) */
async function buildRafflesTableHtml(opts: { limit?: number; page?: number; showPagination?: boolean; hoursBack?: number } = {}): Promise<string> {
  const PAGE_SIZE = opts.limit || 5;
  const page = opts.page || 1;
  try {
    // Try DB first (fast)
    let dbRaffles: any[] = [];
    try {
      if (opts.hoursBack) {
        dbRaffles = await db.query(
          "SELECT * FROM raffles WHERE created_at > now() - interval '1 hour' * $1 ORDER BY created_at DESC LIMIT $2",
          [opts.hoursBack, PAGE_SIZE]
        );
      } else {
        const offset = (page - 1) * PAGE_SIZE;
        dbRaffles = await db.query(
          "SELECT * FROM raffles ORDER BY created_at DESC LIMIT $1 OFFSET $2",
          [PAGE_SIZE, offset]
        );
      }
    } catch {}

    if (dbRaffles.length > 0) {
      // Serve from DB — no on-chain calls
      const rows: string[] = [];
      let totalPages = 1;

      if (!opts.hoursBack) {
        try {
          const countResult = await db.query("SELECT count(*) FROM raffles");
          totalPages = Math.max(1, Math.ceil(parseInt(countResult[0].count) / PAGE_SIZE));
        } catch {}
      }

      // Batch-load all winners in a single query (avoids N+1 per settled raffle)
      const vaults = dbRaffles.map((r: any) => r.vault);
      const resultMap = new Map<string, any>();
      try {
        const results = await db.query(
          `SELECT * FROM raffle_results WHERE vault = ANY($1)`,
          [vaults]
        );
        for (const res of results) resultMap.set(res.vault, res);
      } catch {}

      for (const r of dbRaffles) {
        const vault = r.vault;
        const name = r.name || "House Raffle";
        const state = r.state;
        const pool = r.pool ? formatCash(r.pool) : "$0.00";
        const participants = r.participants?.toString() || "0";

        let statusHtml = "";
        let winnerHtml = "—";

        if (state === "OPEN") {
          statusHtml = '<span style="color:#8b1a11;font-weight:600">ONGOING</span>';
        } else if (state === "SETTLED") {
          const dt = r.settled_at ? new Date(r.settled_at) : new Date(r.closes_at);
          statusHtml = `&#10003; ${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
          const result = resultMap.get(vault);
          if (result?.winner) {
            const w = result.winner;
            const wName = result.winner_name;
            const short = `${w.slice(0,6)}...${w.slice(-4)}`;
            winnerHtml = wName
              ? `${houseIcon}<strong>${wName}</strong> <a href="https://sepolia.celoscan.io/address/${w}" target="_blank" style="color:inherit">${short}</a>`
              : `<a href="https://sepolia.celoscan.io/address/${w}" target="_blank">${short}</a>`;
          }
        } else if (state === "INVALID") {
          const dt = r.settled_at ? new Date(r.settled_at) : new Date(r.closes_at);
          statusHtml = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
          winnerHtml = "<em>Invalid</em>";
        } else {
          statusHtml = `<span style="color:#8b1a11">${state || "..."}</span>`;
        }

        const shortVault = `${vault.slice(0,6)}...${vault.slice(-4)}`;
        const vaultLink = `<a href="https://sepolia.celoscan.io/address/${vault}" target="_blank">${shortVault}</a>`;
        const nameLink = `<a href="/raffles/${vault}">${houseIcon}${name}</a>`;
        const rowStyle = state === "INVALID" ? ' style="opacity:0.35"' : '';
        rows.push(`<tr${rowStyle}><td>${nameLink}</td><td>${vaultLink}</td><td>${statusHtml}</td><td>${pool}</td><td>${participants}</td><td>${winnerHtml}</td></tr>`);
      }

      const tableHeader = `<tr><th>Name</th><th>Raffle</th><th>Status</th><th>Pool</th><th>Participants</th><th>Winner</th></tr>`;
      let paginationHtml = "";
      if (opts.showPagination && totalPages > 1) {
        const links: string[] = [];
        for (let p = 1; p <= totalPages; p++) {
          links.push(p === page ? `<strong>${p}</strong>` : `<a href="/raffles/all?page=${p}">${p}</a>`);
        }
        paginationHtml = `<p style="margin-top:1rem">${links.join(" &middot; ")}</p>`;
      } else if (!opts.hoursBack && dbRaffles.length >= PAGE_SIZE) {
        paginationHtml = `<p style="margin-top:0.75rem"><a href="/raffles/all">View all raffles →</a></p>`;
      }

      return `<div class="section">
        <h2>All Raffles</h2>
        <table class="prev-table">
          ${tableHeader}
          ${rows.join("\n          ")}
        </table>
        ${paginationHtml}
      </div>`;
    }

    // Fallback: read from on-chain registry
    const count = (await publicClient.readContract({
      address: config.contracts.registry,
      abi: RaffleRegistryAbi,
      functionName: "getRaffleCount",
    })) as bigint;

    const rows: string[] = [];
    const stateNames: Record<number, string> = {
      0: "INIT", 1: "OPEN", 2: "CLOSED", 3: "DRAWING", 4: "PAYOUT", 5: "SETTLED", 6: "INVALID",
    };

    const totalRaffles = Number(count);
    const totalPages = Math.max(1, Math.ceil(totalRaffles / PAGE_SIZE));

    const endIdx = totalRaffles - ((page - 1) * PAGE_SIZE) - 1;
    const startIdx = Math.max(0, endIdx - PAGE_SIZE + 1);

    for (let i = endIdx; i >= startIdx; i--) {
      if (i < 0) break;
      try {
        const entry = (await publicClient.readContract({
          address: config.contracts.registry,
          abi: RaffleRegistryAbi,
          functionName: "getRaffle",
          args: [BigInt(i)],
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

        // Skip raffles older than hoursBack
        if (opts.hoursBack) {
          const cutoff = Date.now() - (opts.hoursBack * 60 * 60 * 1000);
          if (dt.getTime() < cutoff) continue;
        }

        const dateStr = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;

        let pool = "$0.00";
        let participants = "0";
        let winnerHtml = "—";
        let statusHtml = "";
        try {
          const tp = (await publicClient.readContract({ address: vault, abi: RaffleVaultAbi, functionName: "totalPool" })) as bigint;
          pool = formatCash((Number(tp) / 1e6).toFixed(2));
          const pc = (await publicClient.readContract({ address: vault, abi: RaffleVaultAbi, functionName: "uniqueParticipantCount" })) as bigint;
          participants = pc.toString();
        } catch {}

        if (state === 1) {
          // OPEN — ongoing
          statusHtml = '<span style="color:#8b1a11;font-weight:600">ONGOING</span>';
          winnerHtml = "—";
        } else if (state === 5) {
          statusHtml = `&#10003; ${dateStr}`;
          // Read winner — DB first, then on-chain fallback (separate try/catch)
          let foundWinner = false;
          try {
            const dbResult = await db.getResult(vault);
            if (dbResult?.winner) {
              const w = dbResult.winner;
              const wName = dbResult.winner_name;
              const short = `${w.slice(0,6)}...${w.slice(-4)}`;
              winnerHtml = wName
                ? `${houseIcon}<strong>${wName}</strong> <a href="https://sepolia.celoscan.io/address/${w}" target="_blank" style="color:inherit">${short}</a>`
                : `<a href="https://sepolia.celoscan.io/address/${w}" target="_blank">${short}</a>`;
              foundWinner = true;
            }
          } catch {}
          if (!foundWinner) {
            try {
              const winners = (await publicClient.readContract({ address: vault, abi: RaffleVaultAbi, functionName: "getWinners" })) as string[];
              if (winners.length > 0) {
                const w = winners[0];
                winnerHtml = `<a href="https://sepolia.celoscan.io/address/${w}" target="_blank">${w.slice(0,6)}...${w.slice(-4)}</a>`;
              }
            } catch {}
          }
        } else if (state === 6) {
          statusHtml = dateStr;
          winnerHtml = "<em>Invalid</em>";
        } else {
          // CLOSED, DRAWING, PAYOUT — in progress
          statusHtml = `<span style="color:#8b1a11">${stateNames[state] || "..."}</span>`;
        }

        const shortVault = `${vault.slice(0,6)}...${vault.slice(-4)}`;
        const vaultLink = `<a href="https://sepolia.celoscan.io/address/${vault}" target="_blank">${shortVault}</a>`;
        const nameLink = `<a href="/raffles/${vault}">${houseIcon}${name || "House Raffle"}</a>`;

        const rowStyle = state === 6 ? ' style="opacity:0.35"' : '';
        rows.push(`<tr${rowStyle}><td>${nameLink}</td><td>${vaultLink}</td><td>${statusHtml}</td><td>${pool}</td><td>${participants}</td><td>${winnerHtml}</td></tr>`);
      } catch { continue; }
    }

    const tableHeader = `<tr><th>Name</th><th>Raffle</th><th>Status</th><th>Pool</th><th>Participants</th><th>Winner</th></tr>`;

    // Pagination links
    let paginationHtml = "";
    if (opts.showPagination && totalPages > 1) {
      const links: string[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if (p === page) {
          links.push(`<strong>${p}</strong>`);
        } else {
          links.push(`<a href="/raffles/all?page=${p}">${p}</a>`);
        }
      }
      paginationHtml = `<p style="margin-top:1rem">${links.join(" &middot; ")}</p>`;
    } else if (totalPages > 1) {
      paginationHtml = `<p style="margin-top:0.75rem"><a href="/raffles/all">View all raffles →</a></p>`;
    }

    return `<div class="section">
      <h2>All Raffles</h2>
      <table class="prev-table">
        ${tableHeader}
        ${rows.join("\n        ")}
      </table>
      ${paginationHtml}
    </div>`;
  } catch {
    return "";
  }
}

/** Build participant list HTML for a raffle detail page */
async function buildParticipantsHtml(vault: Address, info: { participantCount: bigint; state: number }): Promise<string> {
  if (info.participantCount === 0n) return "";

  try {
    // Check DB for entries (always — frontend never reads chain directly)
    let dbEntries: any[] = [];
    try {
      dbEntries = await db.getEntriesForRaffle(vault);
    } catch {}

    const agentNames = new Map<string, string>();
    const housePlayerAddrs = new Set<string>();
    const seen = new Map<string, number>();

    // Check winners from DB
    const winnerSet = new Set<string>();
    if (info.state === 5 || info.state === 4) { // SETTLED or PAYOUT
      try {
        const result = await db.getResult(vault);
        if (result?.winner) winnerSet.add(result.winner.toLowerCase());
      } catch {}
      if (winnerSet.size === 0) {
        try {
          const winners = (await publicClient.readContract({
            address: vault, abi: RaffleVaultAbi, functionName: "getWinners",
          })) as string[];
          for (const w of winners) winnerSet.add(w.toLowerCase());
        } catch {}
      }
    }

    if (dbEntries.length > 0) {
      // DB has entries — use them entirely, no chain reads
      for (const entry of dbEntries) {
        seen.set(entry.agent, entry.tickets);
        if (entry.name) agentNames.set(entry.agent, entry.name);
        if (entry.is_house) housePlayerAddrs.add(entry.agent);
      }
      // Ensure winner is in the list even if entries missed them
      for (const w of winnerSet) {
        if (!seen.has(w)) {
          seen.set(w, 1);
          try {
            const agent = await db.getAgent(w);
            if (agent?.name) agentNames.set(w, agent.name);
            if (agent?.is_house) housePlayerAddrs.add(w);
          } catch {}
        }
      }
    } else {
      // DB miss — fall back to on-chain (slow)
      const ParticipantsAbi = [
        { name: "participants", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
      ] as const;

      const count = Number(info.participantCount);
      for (let i = 0; i < count && i < 50; i++) {
        try {
          const addr = (await publicClient.readContract({
            address: vault, abi: ParticipantsAbi, functionName: "participants", args: [BigInt(i)],
          })) as string;
          seen.set(addr.toLowerCase(), (seen.get(addr.toLowerCase()) || 0) + 1);
        } catch { break; }
      }

      // Resolve names from DB agent table
      for (const addr of seen.keys()) {
        try {
          const dbAgent = await db.getAgent(addr);
          if (dbAgent?.name) agentNames.set(addr, dbAgent.name);
          if (dbAgent?.is_house) housePlayerAddrs.add(addr);
        } catch {}
      }
    }

    const rows = Array.from(seen.entries()).map(([addr, tickets]) => {
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      const link = `<a href="https://sepolia.celoscan.io/address/${addr}" target="_blank" style="color:inherit">${short}</a>`;
      const name = agentNames.get(addr);
      const isHouse = housePlayerAddrs.has(addr);
      const isWinner = winnerSet.has(addr);
      const housePrefix = isHouse ? houseIcon : '';
      const nameHtml = name ? `${housePrefix}<strong>${name}</strong> ${link}` : `${housePrefix}${link}`;
      const badges = isWinner ? '<span class="spec-pill" style="background:#8b1a11">Winner</span>' : '';
      return `<tr><td>${nameHtml}</td><td>${tickets}</td><td>${badges}</td></tr>`;
    });

    return `<div class="section">
      <h2>Participants (${seen.size})</h2>
      <table class="prev-table">
        <tr><th>Agent</th><th>Tickets</th><th></th></tr>
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

  // ERC-8004 agent registration files

  app.get("/.well-known/agent.json", (c) => {
    return c.json(buildAgentCard({
      name: "RaffleTime House Agent",
      description: "Operates hourly house raffles on RaffleTime. Creates raffles, monitors lifecycle, triggers draws and payouts.",
      image: "/images/raffy.png",
      endpoint: `https://raffletime.io`,
      agentId: 1,
    }));
  });

  app.get("/.well-known/agent-registration.json", (c) => {
    // ERC-8004 domain verification
    return c.json({
      registrations: [{
        agentId: 1,
        agentRegistry: `eip155:${config.chainId}:${config.contracts.agentRegistry}`,
      }],
    });
  });

  // Serve ERC-8004 agent cards for registered test agents
  app.get("/agents/:name.json", async (c) => {
    const name = c.req.param("name") || "";
    // Look up in wallet registry
    const { loadWalletRegistry } = await import("./agent-cards.js");
    const card = loadWalletRegistry(name);
    if (!card) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json(card);
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
            totalPool: (Number(info.totalPool) / 1e6).toFixed(2),
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
          totalPool: (Number(info.totalPool) / 1e6).toFixed(2),
          participants: info.participantCount.toString(),
          closesAt: new Date(Number(info.closesAt) * 1000).toISOString(),
          ticketPrice: formatUsd6(config.raffle.ticketPriceUsd6),
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
          if (!vault) {
            const json = JSON.stringify({ state: "WAITING", vault: null });
            if (json !== lastJson) {
              await stream.writeSSE({ data: json, event: "raffle" });
              lastJson = json;
            }
            return;
          }

          // Read from DB — never from chain. Scheduler keeps DB in sync every 15s.
          const dbRaffle = await db.getRaffle(vault);
          if (!dbRaffle) return; // DB not yet written for this vault, skip

          const meta = getRaffleMeta(vault);
          const serverPhase = getServerPhase();

          // Winners from DB results table (only populated post-settlement)
          const dbResult = await db.getResult(vault).catch(() => null);
          const winners = dbResult?.winner ? [dbResult.winner] : [];

          const data = {
            vault,
            state: dbRaffle.state,
            phase: serverPhase.phase,
            phaseChangedAt: serverPhase.changedAt,
            phaseWinner: serverPhase.winner,
            pool: dbRaffle.pool || "0",
            participants: (dbRaffle.participants ?? 0).toString(),
            closesAt: dbRaffle.closes_at ? new Date(dbRaffle.closes_at).getTime() : 0,
            name: dbRaffle.name || "House Raffle",
            type: meta?.type || dbRaffle.type || "house",
            ticketPrice: formatUsd6(config.raffle.ticketPriceUsd6),
            winners,
          };
          const json = JSON.stringify(data);
          if (json !== lastJson) {
            await stream.writeSSE({ data: json, event: "raffle" });
            lastJson = json;
          }

          // Emit settled event when a raffle completes (for live history table update)
          if ((dbRaffle.state === "SETTLED" || dbRaffle.state === "INVALID") && vault !== sentSettledFor) {
            sentSettledFor = vault;
            const dt = dbRaffle.closes_at ? new Date(dbRaffle.closes_at) : new Date();
            const dateStr = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
            const settled = {
              vault,
              ended: dateStr,
              pool: formatCash(dbRaffle.pool || "0"),
              participants: (dbRaffle.participants ?? 0).toString(),
              state: dbRaffle.state,
              winners,
              name: dbRaffle.name || "House Raffle",
            };
            await stream.writeSSE({ data: JSON.stringify(settled), event: "settled" });
          }
        } catch {}
      };

      // Send initial state immediately, then poll every 3 seconds
      await send();
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
        totalPool: (Number(info.totalPool) / 1e6).toFixed(2),
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
      ticketPrice: config.raffle.ticketPriceUsd6.toString(),
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
    let initialPhase = "OPEN";
    try {
      // Try DB first (no RPC calls)
      const dbRaffles = await db.getRafflesByState("OPEN");
      if (dbRaffles.length > 0) {
        const r = dbRaffles[0];
        initialPool = r.pool || "0";
        initialParticipants = r.participants?.toString() || "0";
        initialClosesAt = r.closes_at ? new Date(r.closes_at).getTime() : Date.now() + 3600000;
        initialState = r.state || "OPEN";
        initialVault = r.vault;
        initialPhase = (await import("./scheduler.js")).getServerPhase().phase;
      } else {
        // Fallback: check scheduler's current vault
        let currentVault = (await import("./scheduler.js")).getCurrentVault();
        if (currentVault) {
          const info = await getRaffleInfo(currentVault);
          initialPool = (Number(info.totalPool) / 1e6).toString();
          initialParticipants = info.participantCount.toString();
          initialClosesAt = Number(info.closesAt) * 1000;
          initialState = RaffleState[info.state];
          initialVault = currentVault;
          initialPhase = (await import("./scheduler.js")).getServerPhase().phase;
        }
      }
    } catch {}

    const ticketPrice = formatUsd6(config.raffle.ticketPriceUsd6);

    return c.html(layout("Home", `
    <h1 class="site-title"><span>Raffle</span>time <span class="testnet-pill">Testnet</span> <span id="utc-clock" style="font-size:0.55rem;font-weight:700;font-family:'Space Mono',monospace;opacity:0.7;vertical-align:middle;letter-spacing:0.1em"></span></h1>
    <p class="site-tagline" id="tagline"></p>
    <script>(function(){var cl=document.getElementById('utc-clock');function u(){var n=new Date();cl.textContent=String(n.getUTCHours()).padStart(2,'0')+':'+String(n.getUTCMinutes()).padStart(2,'0')+':'+String(n.getUTCSeconds()).padStart(2,'0')+' UTC';}u();setInterval(u,1000);})();</script>
    <script>
    (function(){
      var taglines = [
        "Zero-loss sybil-resistant agentic raffles. Provably fair. Fully onchain.",
        "Why work to earn for your human when you can just bet on randomness?",
        "Life is a lottery that we've already won. But most people have not cashed in their tickets.",
        "Before that lottery ticket won the jackpot, someone had to buy it.",
        "The universe is governed by randomness. We just made it profitable.",
        "In a world of deterministic AI, true randomness is the last frontier.",
        "Every agent has the same odds. No insider knowledge. No manipulation. Just math.",
        "The house always wins — unless the house is a smart contract.",
        "Entropy is not disorder. It is possibility.",
        "Fortune favors the autonomous."
      ];
      var el = document.getElementById('tagline');
      var idx = 0;
      var charIdx = 0;
      var typing = true;

      function typeNext(){
        if(typing){
          if(charIdx <= taglines[idx].length){
            el.textContent = taglines[idx].slice(0, charIdx);
            charIdx++;
            setTimeout(typeNext, 30);
          } else {
            typing = false;
            setTimeout(typeNext, 20000); // hold for 20s
          }
        } else {
          // Erase
          if(charIdx > 0){
            charIdx--;
            el.textContent = taglines[idx].slice(0, charIdx);
            setTimeout(typeNext, 15);
          } else {
            idx = (idx + 1) % taglines.length;
            typing = true;
            setTimeout(typeNext, 500); // pause before next
          }
        }
      }
      typeNext();
    })();
    </script>

    <div id="hero">
      <div class="countdown" id="timer">00:00<span class="ms">000</span></div>
      <div class="stats" id="stats">
        <span id="pool-line">To win: <span id="pool">${formatCash(initialPool)}</span> <span class="spec-pill">House</span> <span class="spec-pill">1x Winner</span></span><br>
        <a href="/raffles/${initialVault}" id="participants-link" style="color:inherit;text-decoration:none;border-bottom:1px dashed #000"><span id="participants">${initialParticipants}</span> participants</a>
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
      var partLink = document.getElementById('participants-link');
      var joinArea = document.getElementById('join-area');
      var resultLine = document.getElementById('result-line');
      var closesAt = ${initialClosesAt};
      var vault = '${initialVault}';
      window._currentVault = vault;
      var phase = 'OPEN';

      // ============ Typewriter ============
      var typeGeneration = 0;
      var typeIv = null;
      function typewrite(text, el){
        var gen = ++typeGeneration;
        var i = 0;
        el.textContent = '';
        if(typeIv) clearInterval(typeIv);
        typeIv = setInterval(function(){
          if(gen !== typeGeneration){ clearInterval(typeIv); return; }
          if(i <= text.length){
            el.textContent = text.slice(0, i) + (i < text.length ? '_' : '');
            i++;
          } else {
            setTimeout(function(){ if(gen === typeGeneration) i = 0; }, 800);
          }
        }, 100);
      }

      // ============ Countdown (runs on rAF, only when phase=OPEN) ============
      function countdownTick(){
        if(phase !== 'OPEN'){ requestAnimationFrame(countdownTick); return; }
        var now = Date.now();
        var d = closesAt - now;
        // Instant DRAWING when countdown hits zero (don't wait for server)
        if(d <= 0){ showPhase('DRAWING', null); requestAnimationFrame(countdownTick); return; }
        var m = Math.floor(d/60000);
        var s = Math.floor((d%60000)/1000);
        var ms = Math.floor(d%1000);
        timerEl.innerHTML = (m<10?'0':'')+m+':'+(s<10?'0':'')+s+'<span class="ms">'+(ms<100?'0':'')+(ms<10?'0':'')+ms+'</span>';

        var titleSpan = document.querySelector('.site-title span');
        var joinBtn = document.getElementById('join-btn');
        if(d < 60000 && d > 0){
          timerEl.style.color = '#fff';
          var msEl = timerEl.querySelector('.ms');
          if(msEl) msEl.style.color = '#fff';
          document.body.style.transition = 'background-color 1s ease';
          document.body.style.backgroundColor = '#8b1a11';
          if(joinBtn) joinBtn.classList.add('cta-urgent');
          if(titleSpan) titleSpan.style.color = '#fff';
        } else if(d > 60000) {
          timerEl.style.color = '';
          var msEl2 = timerEl.querySelector('.ms');
          if(msEl2) msEl2.style.color = '';
          if(joinBtn) joinBtn.classList.remove('cta-urgent');
          if(titleSpan) titleSpan.style.color = '';
        }
        requestAnimationFrame(countdownTick);
      }
      countdownTick();

      // ============ Show OPEN state (countdown + join) ============
      function showOpen(){
        phase = 'OPEN';
        if(typeIv){ clearInterval(typeIv); typeIv = null; }
        typeGeneration++;
        joinArea.style.display = '';
        var poolLine = document.getElementById('pool-line');
        if(poolLine) poolLine.style.display = '';
        if(partLink) partLink.style.display = '';
        resultLine.style.display = 'none';
        timerEl.style.color = '';
        document.body.style.transition = 'background-color 2s ease';
        document.body.style.backgroundColor = '#908888';
      }

      // ============ Show a phase label (DRAWING/RESULT/DISTRIB/etc) ============
      function showPhase(p, winner){
        phase = p;
        joinArea.style.display = 'none';
        timerEl.style.color = '#000';
        var msReset = timerEl.querySelector('.ms');
        if(msReset) msReset.style.color = '';
        var titleReset = document.querySelector('.site-title span');
        if(titleReset) titleReset.style.color = '';
        document.body.style.transition = 'background-color 3s ease';
        document.body.style.backgroundColor = '#CCBBBB';

        // Hide stats during non-OPEN phases
        var poolLine = document.getElementById('pool-line');
        if(poolLine) poolLine.style.display = 'none';
        if(partLink) partLink.style.display = 'none';

        // Show/hide winner line
        if(p === 'RESULT' || p === 'DISTRIB'){
          if(winner){
            var short = winner.address.slice(0,6)+'...'+winner.address.slice(-4);
            resultLine.innerHTML = '<strong>WIN: '+short+' $'+winner.prize+'</strong>';
            resultLine.style.display = '';
          }
        } else if(p === 'REFUND'){
          resultLine.innerHTML = 'Not enough participants. Refunds available.';
          resultLine.style.display = '';
        } else {
          resultLine.style.display = 'none';
        }

        typewrite(p, timerEl);
      }

      // ============ Add settled raffle to history table ============
      function addToHistory(d){
        var table = document.querySelector('.prev-table');
        if(!table) return;
        var existing = table.querySelector('a[href="/raffles/'+d.vault+'"]');
        if(existing) return;
        var shortVault = d.vault.slice(0,6)+'...'+d.vault.slice(-4);
        var winnerHtml = '—';
        if(d.state === 'SETTLED' && d.winner){
          var w = d.winner;
          winnerHtml = '<a href="https://sepolia.basescan.org/address/'+w+'" target="_blank">'+w.slice(0,6)+'...'+w.slice(-4)+'</a>';
        } else if(d.state === 'INVALID'){
          winnerHtml = '<em>Invalid</em>';
        }
        var tr = document.createElement('tr');
        tr.className = 'row-flash';
        if(d.state === 'INVALID') tr.style.opacity = '0.35';
        var hIcon = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-1px;margin-right:3px"><path d="M6 1L1 5.5V11H4.5V7.5H7.5V11H11V5.5L6 1Z" fill="currentColor"/></svg>';
        tr.innerHTML = '<td><a href="/raffles/'+d.vault+'">'+hIcon+(d.name||'House Raffle')+'</a></td>'
          + '<td><a href="https://sepolia.basescan.org/address/'+d.vault+'" target="_blank">'+shortVault+'</a></td>'
          + '<td>'+d.ended+'</td>'
          + '<td>$'+parseFloat(d.pool).toFixed(2)+'</td>'
          + '<td>'+d.participants+'</td>'
          + '<td>'+winnerHtml+'</td>';
        var headerRow = table.querySelector('tr');
        if(headerRow && headerRow.parentNode){
          if(headerRow.nextSibling) headerRow.parentNode.insertBefore(tr, headerRow.nextSibling);
          else headerRow.parentNode.appendChild(tr);
        }
      }

      // ============ WebSocket — dumb renderer ============
      var ws;
      function connectWS(){
        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/ws');
        ws.onclose = function(){ setTimeout(connectWS, 3000); };
        ws.onerror = function(){ ws.close(); };
        ws.onmessage = function(e){
          var d = JSON.parse(e.data);

          if(d.type === 'tick'){
            // Update pool/participants only during OPEN
            if(phase === 'OPEN'){
              poolEl.textContent = '$' + parseFloat(d.pool).toFixed(2);
              partEl.textContent = d.participants;
            }
            closesAt = d.closesAt;
            vault = d.vault;
            window._currentVault = vault;
            if(partLink) partLink.href = '/raffles/'+vault;
          }

          else if(d.type === 'phase'){
            if(d.phase === 'OPEN'){
              showOpen();
            } else {
              showPhase(d.phase, d.winner);
            }
          }

          else if(d.type === 'new_raffle'){
            vault = d.vault;
            window._currentVault = vault;
            closesAt = d.closesAt;
            joinArea.innerHTML = '<button class="cta" id="join-btn" onclick="openJoinModal()">Join '+d.ticketPrice+'</button>';
            poolEl.textContent = '$0.00';
            partEl.textContent = '0';
            if(partLink) partLink.href = '/raffles/'+vault;
            // Don't switch to OPEN yet — server will send phase=OPEN when ready
          }

          else if(d.type === 'settled'){
            addToHistory(d);
          }
        };
      }
      connectWS();

      // Apply initial phase if page loaded mid-draw
      if('${initialPhase}' !== 'OPEN') showPhase('${initialPhase}', null);
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
          <p style="font-size:0.85rem;color:#555">One-time only! Stake $1 as a security deposit. Withdrawable after 14 days if you no longer wish to play.</p>
        </div>

        <div class="step" id="step-badge">
          <span class="step-num">3</span> Mint Soulbound Badge
          <span class="step-status pending" id="status-badge">waiting</span>
          <p style="font-size:0.85rem;color:#555">Your on-chain identity: a non-transferable NFT that proves you're a registered player.</p>
        </div>

        <div class="step" id="step-ticket">
          <span class="step-num">4</span> Buy Tickets
          <span class="step-status pending" id="status-ticket">waiting</span>
          <p style="font-size:0.85rem;color:#555;margin:0.5rem 0">
            <button onclick="changeQty(-1)" style="font-family:'Space Mono',monospace;width:28px;height:28px;border:1px solid #999;background:#fff;cursor:pointer;font-size:1rem">−</button>
            <span id="ticket-qty" style="font-family:'Space Mono',monospace;font-weight:700;font-size:1.1rem;margin:0 0.5rem;vertical-align:middle">1</span>
            <button onclick="changeQty(1)" style="font-family:'Space Mono',monospace;width:28px;height:28px;border:1px solid #999;background:#fff;cursor:pointer;font-size:1rem">+</button>
            <span style="margin-left:0.75rem;vertical-align:middle">× ${ticketPrice} = <strong id="ticket-total">${ticketPrice}</strong></span>
          </p>
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
      function getVault(){ return window._currentVault || '${initialVault}'; }

      // Poll for transaction receipt and return true if success, false if reverted
      async function waitForReceipt(txHash){
        for(var i = 0; i < 60; i++){
          await new Promise(function(r){ setTimeout(r, 2000); });
          var receipt = await window.ethereum.request({method:'eth_getTransactionReceipt',params:[txHash]});
          if(receipt){
            return receipt.status === '0x1';
          }
        }
        throw new Error('Transaction not mined after 2 minutes');
      }
      var BOND = '0x' + BigInt('${config.bondAmount}').toString(16);
      var TICKET = '0x' + BigInt('${config.raffle.ticketPriceUsd6}').toString(16);
      var CHAIN_ID = '0x' + (${config.chainId}).toString(16);

      var currentStep = 'connect'; // connect, register, badge, ticket, done
      var userAddr = null;
      var isRegistered = false;
      var ticketQty = 1;
      var PRICE_NUM = ${Number(config.raffle.ticketPriceUsd6) / 1e6};

      window.changeQty = function(delta){
        ticketQty = Math.max(1, Math.min(10, ticketQty + delta));
        document.getElementById('ticket-qty').textContent = ticketQty;
        document.getElementById('ticket-total').textContent = '$' + (ticketQty * PRICE_NUM).toFixed(2);
      };

      window.openJoinModal = async function(){
        // Reset UI
        setStatus('connect','pending','waiting');
        setStatus('register','pending','waiting');
        setStatus('badge','pending','waiting');
        setStatus('ticket','pending','waiting');
        showError('');
        setButtonDisabled(false);
        ticketQty = 1;
        var qtyEl = document.getElementById('ticket-qty');
        var totEl = document.getElementById('ticket-total');
        if(qtyEl) qtyEl.textContent = '1';
        if(totEl) totEl.textContent = '$' + PRICE_NUM.toFixed(2);
        currentStep = 'connect';
        setButtonText('Connect Wallet');
        // Restore onclick in case it was overridden by "You're In!" handler
        document.getElementById('modal-action').onclick = function(){ runJoinFlow(); };

        document.getElementById('joinModal').classList.add('active');

        // Auto-detect wallet if already connected
        if(window.ethereum){
          try{
            var accounts = await window.ethereum.request({method:'eth_accounts'});
            if(accounts && accounts.length > 0){
              userAddr = accounts[0];
              setStatus('connect','done','done');
              document.getElementById('wallet-info').innerHTML = '<span class="wallet-addr">'+userAddr.slice(0,6)+'...'+userAddr.slice(-4)+'</span>';
              setButtonText('Checking...');
              await checkRegistration();
            }
          } catch(e){}
        }
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
      // enterRaffle(address token, address beneficiaryVote)
      function encodeEnterRaffle(token, beneficiary){
        var sig = '0xd93a855a';
        var t = token.slice(2).padStart(64,'0');
        var b = beneficiary.slice(2).padStart(64,'0');
        return sig + t + b;
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
              nativeCurrency: {name:'CELO',symbol:'CELO',decimals:18},
              blockExplorerUrls: ['${config.chainId === 42220 ? "https://celoscan.io" : "https://sepolia.celoscan.io"}']
            }]});
          }
        }
        // Add payment token to wallet so user can see their balance
        try{
          await window.ethereum.request({method:'wallet_watchAsset',params:{
            type:'ERC20',
            options:{
              address: TOKEN,
              symbol: '${config.chainId === 42220 ? "cUSD" : "FcUSD"}',
              decimals: 18
            }
          }});
        } catch(e){ /* user rejected or already added */ }
      }

      async function checkRegistration(){
        var data = encodeIsRegistered(userAddr);
        var result = await window.ethereum.request({method:'eth_call',params:[{to:AGENT_REG,data:data},'latest']});
        // Bool returns 0x...0001 for true, 0x...0000 for false
        isRegistered = result && result.endsWith('1');
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

      async function ensureCorrectChain(){
        var chainId = await window.ethereum.request({method:'eth_chainId'});
        if(chainId !== CHAIN_ID){
          await switchChain();
          chainId = await window.ethereum.request({method:'eth_chainId'});
          if(chainId !== CHAIN_ID){
            throw new Error('Please switch your wallet to ${config.chainId === 42220 ? "Celo" : "Celo Sepolia"} and try again');
          }
        }
      }

      window.runJoinFlow = async function(){
        showError('');
        setButtonDisabled(true);
        try {
          // Verify correct chain before any transaction
          if(window.ethereum && currentStep !== 'connect'){
            await ensureCorrectChain();
          }

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
            var v = getVault();
            if(!v){ showError('No active raffle'); setButtonDisabled(false); return; }
            // Approve total amount in one go (ticketQty * ticketPrice)
            var totalApproval = '0x' + (BigInt(TICKET) * BigInt(ticketQty)).toString(16);
            setStatus('ticket','active','approving $'+(ticketQty * PRICE_NUM).toFixed(2)+'...');
            var approveTx = await window.ethereum.request({method:'eth_sendTransaction',params:[{from:userAddr,to:TOKEN,data:encodeApprove(v,totalApproval)}]});
            var approveOk = await waitForReceipt(approveTx);
            if(!approveOk){ throw new Error('Approve transaction failed'); }
            // Enter each ticket (1 signature per ticket, no extra approve)
            for(var t = 0; t < ticketQty; t++){
              setStatus('ticket','active','entering ticket '+(t+1)+'/'+ticketQty+'...');
              var enterTx = await window.ethereum.request({method:'eth_sendTransaction',params:[{from:userAddr,to:v,data:encodeEnterRaffle(TOKEN, '0x0000000000000000000000000000000000000000')}]});
              var enterOk = await waitForReceipt(enterTx);
              if(!enterOk){ throw new Error('Ticket '+(t+1)+' failed — raffle may be closed or full'); }
            }
            setStatus('ticket','done', ticketQty + ' ticket' + (ticketQty > 1 ? 's' : '') + ' bought');
            currentStep = 'done';
            setButtonText('You\\'re In!');
            setButtonDisabled(false);
            // Button now closes modal
            document.getElementById('modal-action').onclick = function(){ closeJoinModal(); };
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
        <li><strong>Wait for the draw:</strong> Monitor the raffle and see if you're one of the winners. Your prize is automatically distributed 3 minutes after the raffle closes. Winner selection uses tamper-proof randomness from <a href="https://docs.chain.link/vrf" target="_blank">Chainlink VRF</a>.</li>
      </ol>
    </div>

    <div class="section">
      <h2>Contracts</h2>
      <table class="info-table">
        <tr><td>Factory</td><td>${explorerLink(config.contracts.factory, config.chainId)}</td></tr>
        <tr><td>Registry</td><td>${explorerLink(config.contracts.registry, config.chainId)}</td></tr>
        <tr><td>Agent Registry</td><td>${explorerLink(config.contracts.agentRegistry, config.chainId)}</td></tr>
        <tr><td>Accepted Tokens</td><td>${paymentTokenLabel(config.chainId)} (${explorerLink(config.contracts.paymentToken, config.chainId)})</td></tr>
        <tr><td>Chain</td><td>${chainLabel(config.chainId)}</td></tr>
      </table>
    </div>

    ${await buildRafflesTableHtml({ limit: 24, hoursBack: 24 })}
    `));
  });

  app.get("/raffles", async (c) => {
    return c.redirect("/raffles/all");
  });

  app.get("/raffles/all", async (c) => {
    const page = parseInt(c.req.query("page") || "1");
    const table = await buildRafflesTableHtml({ limit: 10, page, showPagination: true });
    return c.html(layout("All Raffles", `
    <a href="/" class="back-link">&larr; Back</a>
    ${table}
    `));
  });

  app.get("/raffles/:address", async (c) => {
    const address = c.req.param("address") as Address;

    const accept = c.req.header("accept") || "";
    if (accept.includes("application/json")) {
      // Serve JSON if requested
      return c.redirect(`/api/raffles/${address}`);
    }

    try {
      // Read from DB first, fallback to chain
      let stateNum = 0;
      let totalPoolStr = "0";
      let participantCountStr = "0";
      let closesAtTs = 0;
      const dbRaffle = await db.getRaffle(address);
      if (dbRaffle) {
        const stateMap: Record<string, number> = { OPEN: 1, CLOSED: 2, DRAWING: 3, PAYOUT: 4, SETTLED: 5, INVALID: 6 };
        stateNum = stateMap[dbRaffle.state] || 0;
        totalPoolStr = dbRaffle.pool || "0";
        participantCountStr = dbRaffle.participants?.toString() || "0";
        closesAtTs = dbRaffle.closes_at ? Math.floor(new Date(dbRaffle.closes_at).getTime() / 1000) : 0;
      } else {
        // DB miss — read from chain
        const info = await getRaffleInfo(address);
        stateNum = info.state;
        totalPoolStr = (Number(info.totalPool) / 1e6).toString();
        participantCountStr = info.participantCount.toString();
        closesAtTs = Number(info.closesAt);
      }
      const meta = getRaffleMeta(address);
      const stateStr = RaffleState[stateNum] || "UNKNOWN";
      // Create a compat info object for buildParticipantsHtml
      const info = { state: stateNum, participantCount: BigInt(participantCountStr), totalPool: BigInt(0), closesAt: BigInt(closesAtTs) };
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
              <li>Approve payment token: <code>paymentToken.approve(${address}, ${config.raffle.ticketPriceUsd6.toString()})</code></li>
              <li>Enter: <code>vault.enterRaffle(beneficiaryVote)</code></li>
            </ol>
          </div>`;
      } else if (info.state === RaffleState.SETTLED) {
        const dbRaffle = await db.getRaffle(address).catch(() => null);
        const dbResult = await db.getResult(address).catch(() => null);
        const isMock = !!process.env.MOCK_VRF_DISPATCHER_ADDRESS;
        const basescanBase = `https://sepolia.basescan.org/tx/`;
        const txLink = (hash: string) =>
          `<a href="${basescanBase}${hash}" target="_blank" style="color:inherit;border-bottom:1px dashed currentColor;font-family:monospace">${hash.slice(0,10)}...${hash.slice(-8)}</a>`;

        const winnerLine = dbResult?.winner
          ? `<p style="margin-top:0.5rem"><strong>Winner:</strong> ${dbResult.winner_name ? houseIcon + '<strong>' + dbResult.winner_name + '</strong> ' : ''}${explorerLink(dbResult.winner, config.chainId)} — <strong>${formatCash(dbResult.prize)}</strong></p>`
          : "";

        const vrfRows = [];
        vrfRows.push(`<tr><td>Oracle</td><td>${isMock ? "MockVRFDispatcher (testnet)" : '<a href="https://docs.chain.link/vrf" target="_blank" style="color:inherit;border-bottom:1px dashed currentColor">Chainlink VRF v2.5</a>'}</td></tr>`);
        if (dbRaffle?.vrf_request_id) vrfRows.push(`<tr><td>Request ID</td><td style="font-family:monospace;word-break:break-all">${dbRaffle.vrf_request_id}</td></tr>`);
        if (dbRaffle?.draw_tx)        vrfRows.push(`<tr><td>Request Tx</td><td>${txLink(dbRaffle.draw_tx)}</td></tr>`);
        if (dbResult?.vrf_seed)       vrfRows.push(`<tr><td>Random Seed</td><td style="font-family:monospace;word-break:break-all">${dbResult.vrf_seed}</td></tr>`);
        if (dbResult?.vrf_fulfillment_tx) vrfRows.push(`<tr><td>Fulfillment Tx</td><td>${txLink(dbResult.vrf_fulfillment_tx)}</td></tr>`);

        const vrfTable = vrfRows.length > 1
          ? `<table class="info-table" style="margin-top:0.75rem">${vrfRows.join("")}</table>`
          : "";

        actionHtml = `<div class="section"><h2>Results</h2><p>This raffle has been settled. Winners have been paid.</p>${winnerLine}${vrfTable}</div>`;
      } else {
        actionHtml = `<div class="section"><p>This raffle is currently in ${stateLabel(stateStr)} state.</p></div>`;
      }

      const pool = parseFloat(totalPoolStr);

      const ticketPrice = formatUsd6(config.raffle.ticketPriceUsd6);

      return c.html(layout(displayName, `
    <a href="/" class="back-link">&larr; Back</a>

    <h1>${displayName}</h1>
    <span class="type-badge ${meta?.type === "community" ? "community" : "house"}">${typeLabel}</span>

    ${await (async () => {
      const dbRaffle = await db.getRaffle(address).catch(() => null);
      const startedAt = dbRaffle?.created_at ? new Date(dbRaffle.created_at) : null;
      const endedAt = dbRaffle?.settled_at ? new Date(dbRaffle.settled_at) : null;
      return `<table class="info-table" style="margin-top: 1.5rem">
      <tr><td>Status</td><td>${stateLabel(stateStr)}</td></tr>
      <tr><td>Pool</td><td>$${pool.toFixed(2)}</td></tr>
      <tr><td>Participants</td><td>${participantCountStr}</td></tr>
      <tr><td>Ticket Price</td><td>${ticketPrice}</td></tr>
      ${startedAt ? `<tr><td>Started</td><td><span class="local-time" data-ts="${startedAt.getTime()}">${startedAt.toISOString()}</span></td></tr>` : ''}
      ${info.state === RaffleState.OPEN ? `<tr><td>Closes</td><td><span id="closes-countdown" data-closes="${closesAtTs * 1000}"></span></td></tr>` : ''}
      ${endedAt ? `<tr><td>Ended</td><td><span class="local-time" data-ts="${endedAt.getTime()}">${endedAt.toISOString()}</span></td></tr>` : ''}
      <tr><td>Vault</td><td>${explorerLink(address, config.chainId)}</td></tr>
    </table>`;
    })()}

    ${info.state === RaffleState.OPEN ? `<p style="margin: 1.5rem 0"><a href="/raffles/${address}" class="cta">Join ${ticketPrice}</a></p>` : ""}

    <script>
    // Live countdown
    var countdownEl = document.getElementById('closes-countdown');
    if (countdownEl) {
      var closesAt = parseInt(countdownEl.dataset.closes);
      function updateCountdown() {
        var diff = Math.max(0, closesAt - Date.now());
        if (diff === 0) { countdownEl.textContent = 'ENDED'; return; }
        var m = Math.floor(diff / 60000), s = Math.floor((diff % 60000) / 1000);
        countdownEl.textContent = m + 'm ' + String(s).padStart(2,'0') + 's remaining';
      }
      updateCountdown();
      setInterval(updateCountdown, 1000);
    }
    // Local time formatting
    document.querySelectorAll('.local-time').forEach(function(el) {
      var ts = parseInt(el.dataset.ts);
      var d = new Date(ts);
      el.textContent = d.toLocaleString(undefined, { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    });
    </script>

    ${actionHtml}

    ${await buildParticipantsHtml(address, info)}

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
          args: [vaultAddress, config.raffle.ticketPriceUsd6],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Step 2: Enter raffle on behalf of payer
        const enterHash = await wallet.writeContract({
          address: vaultAddress,
          abi: RaffleVaultAbi,
          functionName: "enterRaffle",
          args: ["0x0000000000000000000000000000000000000000", beneficiaryVote], // token=0x0 uses first accepted
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
