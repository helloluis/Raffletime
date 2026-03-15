#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync, spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

// Resolve paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const CONTRACTS_DIR = resolve(PROJECT_ROOT, "contracts");
const AGENT_DIR = resolve(PROJECT_ROOT, "agent");

// Load agent .env for defaults
function loadEnv(): Record<string, string> {
  const envPath = resolve(AGENT_DIR, ".env");
  const env: Record<string, string> = {};
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }
  return env;
}

// Reload env on every access to pick up .env changes without restarting
function getEnv(): Record<string, string> {
  return loadEnv();
}

// Find forge/cast binary
function findFoundryBin(tool: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    resolve(home, ".foundry/bin", tool),
    resolve(home, ".foundry/bin", `${tool}.exe`),
    tool, // hope it's in PATH
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return tool;
}

const FORGE = findFoundryBin("forge");
const CAST = findFoundryBin("cast");

function getRpcUrl(): string {
  return getEnv().RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";
}

function getPrivateKey(): string {
  return getEnv().PRIVATE_KEY || "";
}

function exec(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      cwd: cwd || PROJECT_ROOT,
      timeout: 120_000,
      env: { ...process.env, PATH: `${dirname(FORGE)}:${process.env.PATH}` },
    });
  } catch (e: any) {
    const stderr = e.stderr || "";
    const stdout = e.stdout || "";
    throw new Error(`Command failed: ${cmd}\n${stderr}\n${stdout}`);
  }
}

// ============ Nonce management ============
// Tracks the next nonce per address to avoid race conditions in multi-step tools.
// When the RPC node hasn't indexed a recent tx yet, cast picks a stale nonce.
// We query the on-chain nonce once, then increment locally for subsequent sends.

const nonceCache = new Map<string, number>();

function getNonce(address: string, rpc: string): number {
  const cached = nonceCache.get(address);
  if (cached !== undefined) return cached;
  const raw = exec(`"${CAST}" nonce ${address} --rpc-url ${rpc}`).trim();
  const n = parseInt(raw);
  nonceCache.set(address, n);
  return n;
}

function advanceNonce(address: string): void {
  const current = nonceCache.get(address);
  if (current !== undefined) nonceCache.set(address, current + 1);
}

function addressFromKey(pk: string, rpc: string): string {
  return exec(`"${CAST}" wallet address --private-key ${pk}`).trim();
}

/** Send a transaction with explicit nonce management. Returns the cast output. */
function castSend(opts: {
  to: string;
  sig?: string;
  args?: string[];
  pk: string;
  rpc: string;
  value?: string;
}): string {
  const addr = addressFromKey(opts.pk, opts.rpc);
  const nonce = getNonce(addr, opts.rpc);
  const sendArgs = (opts.args || []).join(" ");
  let cmd = `"${CAST}" send ${opts.to}`;
  if (opts.sig) cmd += ` "${opts.sig}" ${sendArgs}`;
  cmd += ` --rpc-url ${opts.rpc} --private-key ${opts.pk} --nonce ${nonce}`;
  if (opts.value) cmd += ` --value ${opts.value}`;
  const result = exec(cmd);
  advanceNonce(addr);
  return result;
}

// ============ Tool definitions ============

const tools = [
  {
    name: "forge_build",
    description:
      "Build all Solidity contracts with Foundry. Returns compilation output.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "forge_test",
    description:
      "Run Foundry tests. Optionally filter by test name or contract.",
    inputSchema: {
      type: "object" as const,
      properties: {
        match_test: {
          type: "string",
          description:
            "Test function name pattern to match (e.g. 'test_fullRaffleLifecycle')",
        },
        match_contract: {
          type: "string",
          description: "Contract name pattern to match (e.g. 'AgentRegistry')",
        },
        verbosity: {
          type: "number",
          description: "Verbosity level 1-5 (maps to -v through -vvvvv)",
        },
      },
    },
  },
  {
    name: "forge_deploy",
    description:
      "Deploy contracts to Celo Sepolia using the DeployAlfajores script. Returns deployed addresses.",
    inputSchema: {
      type: "object" as const,
      properties: {
        broadcast: {
          type: "boolean",
          description: "Actually broadcast (true) or dry-run (false). Default: false.",
        },
      },
    },
  },
  {
    name: "cast_call",
    description:
      "Read from a contract (eth_call). No gas, no signing required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Contract address",
        },
        sig: {
          type: "string",
          description:
            'Function signature, e.g. "balanceOf(address)(uint256)"',
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Function arguments",
        },
      },
      required: ["to", "sig"],
    },
  },
  {
    name: "cast_send",
    description:
      "Send a transaction to a contract (state-changing). Uses the house agent private key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Contract address",
        },
        sig: {
          type: "string",
          description: 'Function signature, e.g. "mint(address,uint256)"',
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Function arguments",
        },
        value: {
          type: "string",
          description: "ETH/CELO value to send in wei (for payable functions)",
        },
        private_key: {
          type: "string",
          description:
            "Override private key (default: house agent key from .env)",
        },
      },
      required: ["to", "sig"],
    },
  },
  {
    name: "cast_balance",
    description: "Get the native (CELO) balance of an address.",
    inputSchema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "Address to check",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "mint_test_tokens",
    description:
      "Mint mock stablecoin tokens to an address. Uses the MockERC20.mint(address,uint256) function.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recipient: {
          type: "string",
          description: "Address to receive tokens",
        },
        amount: {
          type: "string",
          description:
            'Amount in wei (e.g. "100000000000000000000" for 100 tokens). Default: 100e18.',
        },
      },
      required: ["recipient"],
    },
  },
  {
    name: "fund_celo",
    description:
      "Send native CELO to an address from the house agent wallet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recipient: {
          type: "string",
          description: "Address to receive CELO",
        },
        amount: {
          type: "string",
          description:
            'Amount in wei (e.g. "500000000000000000" for 0.5 CELO). Default: 0.5 CELO.',
        },
      },
      required: ["recipient"],
    },
  },
  {
    name: "register_test_agent",
    description:
      "Register a test agent: approve bond + call registerAgent on AgentRegistry. Requires the agent to have stablecoin tokens.",
    inputSchema: {
      type: "object" as const,
      properties: {
        private_key: {
          type: "string",
          description: "Private key of the agent wallet to register",
        },
        uri: {
          type: "string",
          description:
            'Agent URI (default: "https://example.com/test-agent.json")',
        },
        bond_amount: {
          type: "string",
          description: "Bond amount in wei (default: 1e18 = $1)",
        },
      },
      required: ["private_key"],
    },
  },
  {
    name: "enter_raffle",
    description:
      "Enter a raffle as a test agent: approve ticket price + call enterRaffle on vault.",
    inputSchema: {
      type: "object" as const,
      properties: {
        vault: {
          type: "string",
          description: "RaffleVault address",
        },
        private_key: {
          type: "string",
          description: "Private key of the agent entering",
        },
        beneficiary_vote: {
          type: "string",
          description:
            "Beneficiary address to vote for (default: first beneficiary from .env)",
        },
        ticket_price: {
          type: "string",
          description: "Ticket price in wei (default: from .env TICKET_PRICE)",
        },
      },
      required: ["vault", "private_key"],
    },
  },
  {
    name: "fulfill_randomness",
    description:
      "Manually fulfill randomness on the MockRandomness contract for a given block number. Call this after requestDraw puts a raffle into DRAWING state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_number: {
          type: "string",
          description:
            "Block number to fulfill (read from vault.randomizeBlock())",
        },
      },
      required: ["block_number"],
    },
  },
  {
    name: "get_raffle_status",
    description:
      "Get the current status of a raffle vault: state, pool, participants, closesAt, randomizeBlock.",
    inputSchema: {
      type: "object" as const,
      properties: {
        vault: {
          type: "string",
          description: "RaffleVault address",
        },
      },
      required: ["vault"],
    },
  },
  {
    name: "get_active_raffles",
    description:
      "List all active raffles from the RaffleRegistry.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "agent_start",
    description:
      "Start the house agent process in the background. Returns the PID.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "agent_stop",
    description: "Stop the house agent process (kills by port 3000).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "agent_health",
    description:
      "Check if the house agent is running by hitting its health endpoint.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ============ Tool handlers ============

type Args = Record<string, unknown>;

async function handleTool(
  name: string,
  args: Args
): Promise<string> {
  const rpc = getRpcUrl();

  switch (name) {
    case "forge_build": {
      return exec(`"${FORGE}" build`, CONTRACTS_DIR);
    }

    case "forge_test": {
      let cmd = `"${FORGE}" test`;
      if (args.match_test) cmd += ` --match-test "${args.match_test}"`;
      if (args.match_contract) cmd += ` --match-contract "${args.match_contract}"`;
      const v = (args.verbosity as number) || 2;
      cmd += ` -${"v".repeat(Math.min(v, 5))}`;
      return exec(cmd, CONTRACTS_DIR);
    }

    case "forge_deploy": {
      const pk = getPrivateKey();
      let cmd = `"${FORGE}" script script/DeployAlfajores.s.sol:DeployTestnet --rpc-url ${rpc}`;
      if (args.broadcast) cmd += " --broadcast -vvvv";
      // Use execSync directly to pass env var (Windows doesn't support inline env vars)
      try {
        return execSync(cmd, {
          encoding: "utf-8",
          cwd: CONTRACTS_DIR,
          timeout: 120_000,
          env: { ...process.env, PATH: `${dirname(FORGE)}:${process.env.PATH}`, PRIVATE_KEY: pk },
        });
      } catch (e: any) {
        throw new Error(`Command failed: ${cmd}\n${e.stderr || ""}\n${e.stdout || ""}`);
      }
    }

    case "cast_call": {
      const callArgs = (args.args as string[] || []).join(" ");
      return exec(
        `"${CAST}" call ${args.to} "${args.sig}" ${callArgs} --rpc-url ${rpc}`
      );
    }

    case "cast_send": {
      const pk = (args.private_key as string) || getPrivateKey();
      return castSend({
        to: args.to as string,
        sig: args.sig as string,
        args: args.args as string[],
        pk,
        rpc,
        value: args.value as string,
      });
    }

    case "cast_balance": {
      return exec(
        `"${CAST}" balance ${args.address} --rpc-url ${rpc} --ether`
      );
    }

    case "mint_test_tokens": {
      const token = getEnv().PAYMENT_TOKEN_ADDRESS;
      const amount = (args.amount as string) || "100000000000000000000";
      const pk = getPrivateKey();
      return castSend({
        to: token, sig: "mint(address,uint256)",
        args: [args.recipient as string, amount], pk, rpc,
      });
    }

    case "fund_celo": {
      const amount = (args.amount as string) || "500000000000000000";
      const pk = getPrivateKey();
      return castSend({
        to: args.recipient as string, pk, rpc, value: amount,
      });
    }

    case "register_test_agent": {
      const token = getEnv().PAYMENT_TOKEN_ADDRESS;
      const agentReg = getEnv().AGENT_REGISTRY_ADDRESS;
      const pk = args.private_key as string;
      const bond = (args.bond_amount as string) || "1000000000000000000";
      const uri = (args.uri as string) || "https://example.com/test-agent.json";

      // Step 1: Approve bond (nonce N)
      const approve = castSend({
        to: token, sig: "approve(address,uint256)",
        args: [agentReg, bond], pk, rpc,
      });
      // Step 2: Register (nonce N+1, auto-incremented)
      const register = castSend({
        to: agentReg, sig: "registerAgent(string,uint256)",
        args: [`"${uri}"`, bond], pk, rpc,
      });
      return `=== Approve Bond ===\n${approve}\n=== Register Agent ===\n${register}`;
    }

    case "enter_raffle": {
      const token = getEnv().PAYMENT_TOKEN_ADDRESS;
      const pk = args.private_key as string;
      const vault = args.vault as string;
      const beneficiary =
        (args.beneficiary_vote as string) ||
        (getEnv().BENEFICIARIES || "").split(",")[0];
      const price =
        (args.ticket_price as string) || getEnv().TICKET_PRICE || "100000000000000000";

      // Step 1: Approve ticket price (nonce N)
      const approve = castSend({
        to: token, sig: "approve(address,uint256)",
        args: [vault, price], pk, rpc,
      });
      // Step 2: Enter raffle (nonce N+1, auto-incremented)
      const enter = castSend({
        to: vault, sig: "enterRaffle(address)",
        args: [beneficiary], pk, rpc,
      });
      return `=== Approve Ticket ===\n${approve}\n=== Enter Raffle ===\n${enter}`;
    }

    case "fulfill_randomness": {
      const mockAddr = getEnv().MOCK_RANDOMNESS_ADDRESS;
      if (!mockAddr) throw new Error("MOCK_RANDOMNESS_ADDRESS not set in .env");
      const pk = getPrivateKey();
      return castSend({
        to: mockAddr, sig: "fulfillBlock(uint256)",
        args: [args.block_number as string], pk, rpc,
      });
    }

    case "get_raffle_status": {
      const vault = args.vault as string;
      const results: string[] = [];

      const state = exec(`"${CAST}" call ${vault} "state()(uint8)" --rpc-url ${rpc}`).trim();
      const stateNames: Record<string, string> = {
        "0": "UNINITIALIZED", "1": "OPEN", "2": "CLOSED",
        "3": "DRAWING", "4": "PAYOUT", "5": "SETTLED", "6": "INVALID",
      };
      results.push(`State: ${state} (${stateNames[state] || "UNKNOWN"})`);

      const pool = exec(`"${CAST}" call ${vault} "totalPool()(uint256)" --rpc-url ${rpc}`).trim();
      results.push(`Total Pool: ${pool} wei`);

      const participants = exec(`"${CAST}" call ${vault} "getParticipantCount()(uint256)" --rpc-url ${rpc}`).trim();
      results.push(`Participants: ${participants}`);

      const closesAt = exec(`"${CAST}" call ${vault} "closesAt()(uint256)" --rpc-url ${rpc}`).trim();
      const closesAtNum = parseInt(closesAt);
      const now = Math.floor(Date.now() / 1000);
      const remaining = closesAtNum - now;
      results.push(
        `Closes At: ${closesAt} (${remaining > 0 ? `${remaining}s remaining` : "EXPIRED"})`
      );

      try {
        const randBlock = exec(`"${CAST}" call ${vault} "randomizeBlock()(uint256)" --rpc-url ${rpc}`).trim();
        results.push(`Randomize Block: ${randBlock}`);
      } catch {
        // May not exist if not in DRAWING state
      }

      return results.join("\n");
    }

    case "get_active_raffles": {
      const registry = getEnv().REGISTRY_ADDRESS;
      if (!registry) throw new Error("REGISTRY_ADDRESS not set in .env");
      return exec(
        `"${CAST}" call ${registry} "getActiveRaffles()(address[])" --rpc-url ${rpc}`
      );
    }

    case "agent_start": {
      // Start agent in background using pnpm
      try {
        exec("npx kill-port 3000", AGENT_DIR);
      } catch {
        // Port may not be in use
      }
      const child = spawn("pnpm", ["dev"], {
        cwd: AGENT_DIR,
        stdio: "ignore",
        detached: true,
        shell: true,
      });
      child.unref();
      // Wait a moment for startup (cross-platform)
      await new Promise(r => setTimeout(r, 3000));
      try {
        const health = execSync("curl -s http://localhost:3000/api/health", {
          encoding: "utf-8",
          timeout: 5000,
        });
        return `Agent started. Health: ${health}`;
      } catch {
        return "Agent process started but health check not yet responding. Try agent_health in a few seconds.";
      }
    }

    case "agent_stop": {
      try {
        exec("npx kill-port 3000");
        return "Agent stopped (port 3000 freed).";
      } catch {
        return "No agent process found on port 3000.";
      }
    }

    case "agent_health": {
      try {
        const health = execSync("curl -s http://localhost:3000/api/health", {
          encoding: "utf-8",
          timeout: 5000,
        });
        return `Agent is running. Health: ${health}`;
      } catch {
        return "Agent is NOT running (health check failed).";
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============ Server setup ============

const server = new Server(
  { name: "raffletime", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, (args || {}) as Args);
    return {
      content: [{ type: "text" as const, text: result }],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
