import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ============ Types ============

export type RaffleType = "house" | "community";

export interface RaffleMeta {
  /** Vault contract address */
  vault: string;
  /** Human-readable raffle name */
  name: string;
  /** Short description */
  description: string;
  /** "house" (operated by house agent) or "community" (created by third-party) */
  type: RaffleType;
  /** Cover image URL or path */
  coverImage: string;
  /** Creator address */
  creator: string;
  /** ISO timestamp when created */
  createdAt: string;
}

// ============ Storage ============

const STORE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/raffles.json"
);

function ensureDir() {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadStore(): Record<string, RaffleMeta> {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, RaffleMeta>) {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// ============ Public API ============

export function saveRaffleMeta(meta: RaffleMeta): void {
  const store = loadStore();
  store[meta.vault.toLowerCase()] = meta;
  saveStore(store);
}

export function getRaffleMeta(vault: string): RaffleMeta | null {
  const store = loadStore();
  return store[vault.toLowerCase()] || null;
}

export function getAllRaffleMeta(): RaffleMeta[] {
  return Object.values(loadStore());
}

export function getRafflesByType(type: RaffleType): RaffleMeta[] {
  return getAllRaffleMeta().filter((r) => r.type === type);
}

// ============ House raffle name generator ============

const HOUSE_RAFFLE_NAMES = [
  "Eyes on the Prize",
  "Lucky Break",
  "Fortune's Wheel",
  "Golden Hour",
  "Jackpot Junction",
  "Winner's Circle",
  "The Big Draw",
  "Treasure Hunt",
  "Chance of a Lifetime",
  "Roll of the Dice",
  "The Grand Raffle",
  "Pot of Gold",
  "High Stakes",
  "Lady Luck",
  "Cash Splash",
  "Prize Parade",
  "Lucky Stars",
  "The Windfall",
  "Fast Fortune",
  "The Lightning Round",
];

const COVER_IMAGES = [
  "/images/raffle-gold.png",
  "/images/raffle-treasure.png",
  "/images/raffle-stars.png",
  "/images/raffle-dice.png",
  "/images/raffle-wheel.png",
  "/images/raffle-confetti.png",
];

let nameIndex = 0;

/** Pick the next house raffle name (cycles through the list) */
export function nextHouseRaffleName(): string {
  const name = HOUSE_RAFFLE_NAMES[nameIndex % HOUSE_RAFFLE_NAMES.length];
  nameIndex++;
  return name;
}

/** Pick a random cover image */
export function randomCoverImage(): string {
  return COVER_IMAGES[Math.floor(Math.random() * COVER_IMAGES.length)];
}
