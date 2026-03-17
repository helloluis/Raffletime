/**
 * Player operations: create, fund, register, enter raffle, rebalance, sweep.
 * Wallet signing powered by Tether WDK (@tetherto/wdk + @tetherto/wdk-wallet-evm).
 */

import {
  createPublicClient, createWalletClient, http, parseEther,
  defineChain, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getPlayerAddress, loadSeed, getPlayerWalletClient,
} from "./wallet.js";
import {
  type Player, type RiskProfile, addPlayer, updatePlayer, loadRegistry,
  getActivePlayers, ticketsForProfile, nameForIndex,
} from "./registry.js";
import { config } from "./config.js";

function formatUsd6(raw: bigint): string {
  return (Number(raw) / 1e6).toFixed(2);
}

const chain = defineChain({
  id: config.chainId,
  name: config.chainId === 8453 ? "Base" : "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
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
      budgetTotal: opts.budgetTotal || "50000000",  // $50 USDC (6 decimals)
      budgetPerRaffle: opts.budgetPerRaffle || "300000",  // $0.30 USDC per raffle
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
    console.log(`  Created ${name} (${address.slice(0, 10)}...) [index ${index}]`);
  }

  return created;
}

// ============ Fund players ============

export async function fundPlayers(
  seedPassword: string,
  treasuryKey: `0x${string}`,
  opts: { ethAmount?: bigint; tokenAmount?: bigint } = {}
): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry().filter((p) => !p.paused);
  const ethAmt = opts.ethAmount || parseEther("0.005"); // 0.005 ETH for gas

  // Detect token decimals — USDC=6, mock=18
  let tokenDecimals = 6;
  try {
    const dec = await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "decimals",
    });
    tokenDecimals = Number(dec);
  } catch {}
  const tokenAmt = opts.tokenAmount || BigInt(5 * (10 ** tokenDecimals)); // $5

  const treasuryAccount = privateKeyToAccount(treasuryKey);
  const treasuryWallet = createWalletClient({
    account: treasuryAccount, chain, transport: http(config.rpcUrl),
  });

  for (const player of players) {
    // Check treasury balances before each player to avoid over-spending
    const treasuryEth = await publicClient.getBalance({ address: treasuryAccount.address });
    const treasuryTokens = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [treasuryAccount.address],
    })) as bigint;

    // Top up ETH for gas
    const ethBalance = await publicClient.getBalance({ address: player.address as Address });
    if (ethBalance < ethAmt) {
      if (treasuryEth < ethAmt + parseEther("0.002")) {
        console.log(`  ${player.name}: skipped (treasury low on ETH)`);
        continue;
      }
      const hash = await treasuryWallet.sendTransaction({
        to: player.address as Address, value: ethAmt, chain,
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${player.name}: funded ${Number(ethAmt) / 1e18} ETH`);
    }

    // Top up tokens
    const tokenBalance = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [player.address as Address],
    })) as bigint;

    if (tokenBalance < tokenAmt) {
      if (treasuryTokens < tokenAmt) {
        console.log(`  ${player.name}: skipped (treasury low on tokens: $${formatUsd6(treasuryTokens)})`);
        continue;
      }
      const needed = tokenAmt - tokenBalance;
      if (config.isMockToken) {
        const hash = await treasuryWallet.writeContract({
          address: config.paymentToken, abi: ERC20_ABI, functionName: "mint",
          args: [player.address as Address, needed],
        chain } as any);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  ${player.name}: minted $${(Number(needed) / (10 ** tokenDecimals)).toFixed(2)}`);
      } else {
        const hash = await treasuryWallet.writeContract({
          address: config.paymentToken, abi: ERC20_ABI, functionName: "transfer",
          args: [player.address as Address, needed],
        chain } as any);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  ${player.name}: transferred $${(Number(needed) / (10 ** tokenDecimals)).toFixed(2)}`);
      }
    }
  }
}

// ============ Register players (WDK signs transactions) ============

export async function registerPlayers(seedPassword: string): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry().filter((p) => !p.registered && !p.paused);

  for (const player of players) {
    const address = player.address as Address;

    const isReg = (await publicClient.readContract({
      address: config.agentRegistry, abi: AGENT_REG_ABI, functionName: "isRegistered",
      args: [address],
    })) as boolean;

    if (isReg) {
      updatePlayer(player.index, { registered: true });
      console.log(`  ${player.name}: already registered`);
      continue;
    }

    const wallet = getPlayerWalletClient(mnemonic, player.index, config.rpcUrl, config.chainId);
    const bond = BigInt(1000000); // $1 USDC

    // Check if approve is needed (skip if allowance already sufficient)
    const allowance = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "allowance",
      args: [address, config.agentRegistry],
    })) as bigint;

    if (allowance < bond) {
      // Approve bond — nonceManager tracks nonce in-memory for sequential TXs
      const approveHash = await wallet.writeContract({
        address: config.paymentToken, abi: ERC20_ABI, functionName: "approve",
        args: [config.agentRegistry, bond],
      chain } as any);
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    // Register agent
    const uri = `https://raffletime.io/agents/${player.name.toLowerCase().replace(/\s+/g, "-")}.json`;
    const regHash = await wallet.writeContract({
      address: config.agentRegistry, abi: AGENT_REG_ABI, functionName: "registerAgent",
      args: [uri, bond],
    chain } as any);
    await publicClient.waitForTransactionReceipt({ hash: regHash });

    updatePlayer(player.index, {
      registered: true,
      totalSpent: (BigInt(player.totalSpent) + bond).toString(),
    });
    console.log(`  ${player.name}: registered (bond $1 USDC)`);
  }
}

// ============ Enter raffle (WDK signs transactions) ============

export async function enterRaffle(
  seedPassword: string,
  vault: Address,
  playerSubset?: Player[]
): Promise<{ entered: string[]; skipped: string[] }> {
  const mnemonic = loadSeed(seedPassword);
  const players = playerSubset || getActivePlayers();
  const entered: string[] = [];
  const skipped: string[] = [];

  const state = (await publicClient.readContract({
    address: vault, abi: VAULT_ABI, functionName: "state",
  })) as number;
  if (state !== 1) throw new Error(`Raffle not open (state ${state})`);

  let beneficiary: Address = "0x0000000000000000000000000000000000000000";
  try {
    const bens = (await publicClient.readContract({
      address: vault, abi: VAULT_ABI, functionName: "getBeneficiaryOptions",
    })) as Address[];
    if (bens.length > 0) beneficiary = bens[0];
  } catch {}

  const ticketPrice = BigInt(100000); // $0.10 USDC

  for (const player of players) {
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

    const wallet = getPlayerWalletClient(mnemonic, player.index, config.rpcUrl, config.chainId);
    const playerAddr = player.address as Address;

    try {
      for (let t = 0; t < tickets; t++) {
        // Approve ticket price — nonceManager tracks sequential nonces in-memory
        const approveHash = await wallet.writeContract({
          address: config.paymentToken, abi: ERC20_ABI, functionName: "approve",
          args: [vault, ticketPrice],
        chain } as any);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Enter raffle
        const enterHash = await wallet.writeContract({
          address: vault, abi: VAULT_ABI, functionName: "enterRaffle",
          args: [config.paymentToken, beneficiary],
        chain } as any);
        await publicClient.waitForTransactionReceipt({ hash: enterHash });
      }

      updatePlayer(player.index, {
        totalSpent: (spent + cost).toString(),
        rafflesEntered: player.rafflesEntered + 1,
        lastActive: new Date().toISOString(),
      });
      entered.push(`${player.name}: ${tickets} ticket${tickets > 1 ? "s" : ""} ($${formatUsd6(cost)})`);
    } catch (e) {
      skipped.push(`${player.name}: tx failed — ${String(e).slice(0, 60)}`);
    }
  }

  return { entered, skipped };
}

// ============ Rebalance (WDK signs transfers) ============

export async function rebalancePlayers(
  seedPassword: string,
  targetBalance: bigint = BigInt(3_000_000) // $3 USDC
): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry().filter((p) => !p.paused);

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
    const donor = rich.find((r) => r.balance > needed + targetBalance);
    if (!donor) continue;

    const wallet = getPlayerWalletClient(mnemonic, donor.player.index, config.rpcUrl, config.chainId);
    const hash = await wallet.writeContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "transfer",
      args: [poorPlayer.player.address as Address, needed],
    chain } as any);
    await publicClient.waitForTransactionReceipt({ hash });

    donor.balance -= needed;
    console.log(`  ${donor.player.name} → ${poorPlayer.player.name}: $${formatUsd6(needed)}`);
  }
}

// ============ Sweep winnings (WDK signs transfers) ============

export async function sweepWinnings(
  seedPassword: string,
  coldWallet: Address,
  threshold: bigint = BigInt(10_000_000) // $10 USDC
): Promise<void> {
  const mnemonic = loadSeed(seedPassword);
  const players = loadRegistry();

  for (const p of players) {
    const balance = (await publicClient.readContract({
      address: config.paymentToken, abi: ERC20_ABI, functionName: "balanceOf",
      args: [p.address as Address],
    })) as bigint;

    if (balance > threshold) {
      const sweepAmount = balance - BigInt(1_000_000); // Keep $1 USDC
      const wallet = getPlayerWalletClient(mnemonic, p.index, config.rpcUrl, config.chainId);
      const hash = await wallet.writeContract({
        address: config.paymentToken, abi: ERC20_ABI, functionName: "transfer",
        args: [coldWallet, sweepAmount],
      chain } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${p.name}: swept $${formatUsd6(sweepAmount)} → cold wallet`);
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
      balance = `$${formatUsd6(bal)}`;
    } catch {}

    const spent = (Number(BigInt(p.totalSpent)) / 1e6).toFixed(2);
    const won = (Number(BigInt(p.totalWon)) / 1e6).toFixed(2);
    const pnl = parseFloat(won) - parseFloat(spent);
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    const status = p.paused ? " [PAUSED]" : "";

    lines.push(
      `${(p.name + status).padEnd(16)} ${p.address.slice(0,6)}...${p.address.slice(-4)}  ${balance.padStart(10)} ${("$" + spent).padStart(10)} ${("$" + won).padStart(10)} ${pnlStr.padStart(10)} ${p.riskProfile.padStart(12)} ${String(p.rafflesEntered).padStart(7)}`
    );
  }

  return lines;
}
