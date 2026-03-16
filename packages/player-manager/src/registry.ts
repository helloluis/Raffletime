/**
 * Player registry — persistent JSON storage for player metadata, budgets, and stats.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = resolve(__dirname, "../data/players.json");

export type RiskProfile = "conservative" | "moderate" | "aggressive";

export interface Player {
  index: number;          // HD derivation index
  address: string;
  name: string;
  registered: boolean;    // Has on-chain agent registration
  agentId: number | null; // On-chain agent NFT ID
  paused: boolean;

  // Budget
  budgetTotal: string;      // Max lifetime spend (wei)
  budgetPerRaffle: string;  // Max spend per raffle (wei)
  riskProfile: RiskProfile; // Determines ticket count per raffle

  // Stats
  totalSpent: string;       // Cumulative spend (wei)
  totalWon: string;         // Cumulative winnings (wei)
  rafflesEntered: number;
  rafflesWon: number;
  lastActive: string | null; // ISO timestamp

  createdAt: string;
}

function ensureDir() {
  const dir = dirname(REGISTRY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadRegistry(): Player[] {
  if (!existsSync(REGISTRY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveRegistry(players: Player[]) {
  ensureDir();
  writeFileSync(REGISTRY_FILE, JSON.stringify(players, null, 2));
}

export function getPlayer(indexOrName: number | string): Player | null {
  const players = loadRegistry();
  if (typeof indexOrName === "number") {
    return players.find((p) => p.index === indexOrName) || null;
  }
  return players.find(
    (p) => p.name.toLowerCase() === indexOrName.toLowerCase()
  ) || null;
}

export function getActivePlayers(): Player[] {
  return loadRegistry().filter((p) => !p.paused && p.registered);
}

export function addPlayer(player: Player) {
  const players = loadRegistry();
  const existing = players.findIndex((p) => p.index === player.index);
  if (existing >= 0) {
    players[existing] = player;
  } else {
    players.push(player);
  }
  saveRegistry(players);
}

export function updatePlayer(index: number, updates: Partial<Player>) {
  const players = loadRegistry();
  const i = players.findIndex((p) => p.index === index);
  if (i < 0) throw new Error(`Player ${index} not found`);
  players[i] = { ...players[i], ...updates };
  saveRegistry(players);
}

/** How many tickets should this player buy based on their risk profile */
export function ticketsForProfile(profile: RiskProfile, maxPerUser: number): number {
  switch (profile) {
    case "conservative": return 1;
    case "moderate": return Math.min(2, maxPerUser);
    case "aggressive": return Math.min(3, maxPerUser);
  }
}

// ============ Coffee bean names ============

const NAMES = [
  "Arabica", "Robusta", "Typica", "Bourbon", "Caturra", "Gesha",
  "Maragogype", "Pacamara", "Mokka", "Peaberry", "Sidamo", "Yirgacheffe",
  "Harrar", "Mandheling", "Lintong", "Gayo", "Toraja", "Antigua",
  "Tarrazu", "Supremo", "Huila", "Kilimanjaro", "Nyeri", "Kirinyaga",
  "Kayanza", "Ngozi", "Kigali", "Jimma", "Guji", "Kaffa",
  "Oaxaca", "Chiapas", "Jaltenango", "Chanchamayo", "Cusco", "Cajamarca",
  "Loja", "Matagalpa", "Jinotega", "Copan", "Marcala",
  "Sagada", "Benguet", "Cordillera", "Doi Chaang", "Bolaven", "Dalat",
];

export function nameForIndex(index: number): string {
  if (index < NAMES.length) return NAMES[index];
  return `${NAMES[index % NAMES.length]}-${Math.floor(index / NAMES.length) + 1}`;
}
