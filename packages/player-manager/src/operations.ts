/**
 * Player operations: create, fund, register, enter raffle, rebalance, sweep.
 */

import {
  createPublicClient, http, formatEther, parseEther, defineChain, type Address, type Chain,
} from "viem";
import {
  getPlayerAccount, getPlayerAddress, getPlayerWalletClient, loadSeed,
} from "./wallet.js";
import {
  type Player, type RiskProfile, addPlayer, updatePlayer, loadRegistry,
  getActivePlayers, ticketsForProfile, nameForIndex, saveRegistry,
} from "./registry.js";
import { config } from "./config.js";

const chain = defineChain({
  id: config.chainId,
  name: config.chainId === 42220 ? "Celo" : "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const AGENT_REG_ABI = [
  { name: "registerAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }, { name: "bondAmount", type: "uint256" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { name: "isRegistered", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const VAULT_ABI = [
  { name: "enterRaffle", type: "function", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "beneficiaryVote", type: "address" }], outputs: [] },
  { name: "state", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { name: "getBeneficiaryOptions", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
] as const;

// ============ Create players ============

export async function createPlayers(
  count: number,
  seedPassword: string,
  opts: {
    budgetTotal?: string;
    budgetPerRaffle?: string;
    riskProfile?: RiskProfile;
  } = {}
): Promise<Player[]> {
  const mnemonic = loadSeed(seedPassword);
  const existing = loadRegistry();
  const startIndex = existing.length;
  const created: Player[] = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const address = getPlayerAddress(mnemonic, index);
    const name = nameForIndex(index);

    const player: Player = {
      index,
      address,
      name,
      registered: false,
      agentId: null,
      paused: false,
      budgetTotal: opts.budgetTotal || "50000000", // $50 in 6-decimal USD
      budgetPerRaffle: opts.budgetPerRaffle || parseEther("0.30").toString(),
      riskProfile: opts.riskProfile || "moderate",
      totalSpent: "0",
      totalWon: "0",
      rafflesEntered: 0,
      rafflesWon: 0,
      lastActive: null,
      createdAt: new Date().toISOString(),
    };

    addPlayer(player);
    created.push(player);
    console.log(`  Created ${name} (${address.slice(0, 10)}...) [${index}]`);
  }

  return created;
}

// ============ Fund players ============

export async function fundPlayers(
  seedPassword: string,
  treasuryKey: `0x${string}`,
  opts: { celoAmount?: bigint; tokenAmount?: bigint } = {}
): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry().filter((p) => !p.paused);
  const celoAmt = opts.celoAmount || parseEther("0.1");
  // Detect token decimals — USDC=6, cUSD=18
  let tokenDecimals = 18;
  try {
    const dec = await publicClient.readContract({
      address: config.paymentToken,
      abi: [{ name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] }] as const,
      functionName: "decimals",
    });
    tokenDecimals = Number(dec);
  } catch {}
  const tokenAmt = opts.tokenAmount || BigInt(5 * (10 ** tokenDecimals)); // $5 in token's decimals

  const treasuryAccount = (await import("viem/accounts")).privateKeyToAccount(treasuryKey);
  const treasuryWallet = (await import("viem")).createWalletClient({
    account: treasuryAccount, chain, transport: http(config.rpcUrl),
  });

  for (const player of players) {
    // Check treasury balances before each player to avoid over-spending
    const treasuryCelo = await publicClient.getBalance({ address: treasuryAccount.address });
    const treasuryTokens = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [treasuryAccount.address],
    })) as bigint;

    // Check CELO balance
    const celoBalance = await publicClient.getBalance({ address: player.address as Address });
    if (celoBalance < celoAmt) {
      if (treasuryCelo < celoAmt + parseEther("0.01")) { // keep some for gas
        console.log(`  ${player.name}: skipped (treasury low on CELO)`);
        continue;
      }
      const hash = await treasuryWallet.sendTransaction({
        to: player.address as Address,
        value: celoAmt,
        chain,
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${player.name}: funded ${formatEther(celoAmt)} CELO`);
    }

    // Check token balance
    const tokenBalance = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [player.address as Address],
    })) as bigint;

    if (tokenBalance < tokenAmt) {
      if (treasuryTokens < tokenAmt) {
        console.log(`  ${player.name}: skipped (treasury low on tokens: $${(Number(treasuryTokens) / (10 ** tokenDecimals)).toFixed(2)})`);
        continue;
      }
      const needed = tokenAmt - tokenBalance;
      // If mock token, mint. Otherwise transfer from treasury.
      if (config.isMockToken) {
        const hash = await treasuryWallet.writeContract({
          address: config.paymentToken, abi: ERC20_ABI, functionName: "mint",
          args: [player.address as Address, needed],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  ${player.name}: minted $${(Number(needed) / (10 ** tokenDecimals)).toFixed(2)}`);
      } else {
        const hash = await treasuryWallet.writeContract({
          address: config.paymentToken, abi: ERC20_ABI, functionName: "transfer",
          args: [player.address as Address, needed],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  ${player.name}: transferred $${(Number(needed) / (10 ** tokenDecimals)).toFixed(2)}`);
      }
    }
  }
}

// ============ Register players ============

export async function registerPlayers(seedPassword: string): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry().filter((p) => !p.registered && !p.paused);

  for (const player of players) {
    const wallet = getPlayerWalletClient(mnemonic, player.index, chain, config.rpcUrl);
    const address = player.address as Address;

    // Check if already registered on-chain
    const isReg = (await publicClient.readContract({
      address: config.agentRegistry, abi: AGENT_REG_ABI, functionName: "isRegistered",
      args: [address],
    })) as boolean;

    if (isReg) {
      updatePlayer(player.index, { registered: true });
      console.log(`  ${player.name}: already registered`);
      continue;
    }

    // Approve bond
    const bond = BigInt(1000000); // $1 USDC (6 decimals)
    let hash = await wallet.writeContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "approve",
      args: [config.agentRegistry, bond],
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });

    // Register
    const uri = `https://raffletime.io/agents/${player.name.toLowerCase().replace(/\s+/g, "-")}.json`;
    hash = await wallet.writeContract({
      address: config.agentRegistry, abi: AGENT_REG_ABI, functionName: "registerAgent",
      args: [uri, bond],
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });

    updatePlayer(player.index, {
      registered: true,
      totalSpent: (BigInt(player.totalSpent) + bond).toString(),
    });
    console.log(`  ${player.name}: registered (bond $1)`);
  }
}

// ============ Enter raffle ============

export async function enterRaffle(
  seedPassword: string,
  vault: Address,
  playerSubset?: Player[]
): Promise<{ entered: string[]; skipped: string[] }> {
  const mnemonic = loadSeed(seedPassword);
  const players = playerSubset || getActivePlayers();
  const entered: string[] = [];
  const skipped: string[] = [];

  // Check vault state
  const state = (await publicClient.readContract({
    address: vault, abi: VAULT_ABI, functionName: "state",
  })) as number;
  if (state !== 1) throw new Error(`Raffle not open (state ${state})`);

  // Get beneficiary
  let beneficiary: Address = "0x0000000000000000000000000000000000000000";
  try {
    const bens = (await publicClient.readContract({
      address: vault, abi: VAULT_ABI, functionName: "getBeneficiaryOptions",
    })) as Address[];
    if (bens.length > 0) beneficiary = bens[0];
  } catch {}

  const ticketPrice = BigInt(100000); // $0.10 in 6-decimal USD

  for (const player of players) {
    // Budget check
    const spent = BigInt(player.totalSpent);
    const budgetTotal = BigInt(player.budgetTotal);
    const budgetPerRaffle = BigInt(player.budgetPerRaffle);
    const tickets = ticketsForProfile(player.riskProfile, 3);
    const cost = ticketPrice * BigInt(tickets);

    if (spent + cost > budgetTotal) {
      skipped.push(`${player.name}: budget exhausted`);
      continue;
    }
    if (cost > budgetPerRaffle) {
      skipped.push(`${player.name}: exceeds per-raffle budget`);
      continue;
    }

    const wallet = getPlayerWalletClient(mnemonic, player.index, chain, config.rpcUrl);

    try {
      for (let t = 0; t < tickets; t++) {
        // Approve
        let hash = await wallet.writeContract({
          address: config.paymentToken, abi: ERC20_ABI, functionName: "approve",
          args: [vault, ticketPrice],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash });

        // Enter
        hash = await wallet.writeContract({
          address: vault, abi: VAULT_ABI, functionName: "enterRaffle",
          args: ["0x0000000000000000000000000000000000000000" as Address, beneficiary],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash });
      }

      updatePlayer(player.index, {
        totalSpent: (spent + cost).toString(),
        rafflesEntered: player.rafflesEntered + 1,
        lastActive: new Date().toISOString(),
      });

      entered.push(`${player.name}: ${tickets} ticket${tickets > 1 ? "s" : ""} ($${formatEther(cost)})`);
    } catch (e) {
      skipped.push(`${player.name}: tx failed — ${String(e).slice(0, 60)}`);
    }
  }

  return { entered, skipped };
}

// ============ Rebalance ============

export async function rebalancePlayers(
  seedPassword: string,
  targetBalance: bigint = parseEther("3")
): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry().filter((p) => !p.paused);

  // Find rich and poor players
  const balances: { player: Player; balance: bigint }[] = [];
  for (const p of players) {
    const bal = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [p.address as Address],
    })) as bigint;
    balances.push({ player: p, balance: bal });
  }

  const rich = balances.filter((b) => b.balance > targetBalance * 2n);
  const poor = balances.filter((b) => b.balance < targetBalance / 2n);

  for (const poorPlayer of poor) {
    const needed = targetBalance - poorPlayer.balance;
    // Find a rich player to transfer from
    const donor = rich.find((r) => r.balance > needed + targetBalance);
    if (!donor) continue;

    const donorWallet = getPlayerWalletClient(mnemonic, donor.player.index, chain, config.rpcUrl);
    const hash = await donorWallet.writeContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "transfer",
      args: [poorPlayer.player.address as Address, needed],
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });

    donor.balance -= needed;
    console.log(`  ${donor.player.name} → ${poorPlayer.player.name}: $${formatEther(needed)}`);
  }
}

// ============ Sweep winnings ============

export async function sweepWinnings(
  seedPassword: string,
  coldWallet: Address,
  threshold: bigint = BigInt(10000000) // $10 USDC
): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry();

  for (const p of players) {
    const balance = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [p.address as Address],
    })) as bigint;

    if (balance > threshold) {
      const sweepAmount = balance - BigInt(1000000); // Keep $1 USDC
      const wallet = getPlayerWalletClient(mnemonic, p.index, chain, config.rpcUrl);
      const hash = await wallet.writeContract({
        address: config.paymentToken, abi: ERC20_ABI, functionName: "transfer",
        args: [coldWallet, sweepAmount],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${p.name}: swept $${formatEther(sweepAmount)} → cold wallet`);
    }
  }
}

// ============ Status ============

export async function getStatus(seedPassword: string): Promise<string[]> {
  const players = loadRegistry();
  const lines: string[] = [];

  lines.push(`Players: ${players.length} (${players.filter(p => !p.paused).length} active)`);
  lines.push("");
  lines.push("Name            Address          Balance    Spent      Won        P&L        Risk         Raffles");
  lines.push("─".repeat(110));

  for (const p of players) {
    let balance = "?";
    try {
      const bal = (await publicClient.readContract({
        address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
        args: [p.address as Address],
      })) as bigint;
      balance = `$${parseFloat(formatEther(bal)).toFixed(2)}`;
    } catch {}

    const spent = parseFloat(formatEther(BigInt(p.totalSpent)));
    const won = parseFloat(formatEther(BigInt(p.totalWon)));
    const pnl = won - spent;
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    const status = p.paused ? " [PAUSED]" : "";

    lines.push(
      `${(p.name + status).padEnd(16)} ${p.address.slice(0,6)}...${p.address.slice(-4)}  ${balance.padStart(10)} ${("$" + spent.toFixed(2)).padStart(10)} ${("$" + won.toFixed(2)).padStart(10)} ${pnlStr.padStart(10)} ${p.riskProfile.padStart(12)} ${String(p.rafflesEntered).padStart(7)}`
    );
  }

  return lines;
}
