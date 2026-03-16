/**
 * Agent identity cache — avoids repeated on-chain lookups.
 * File-backed so it persists across restarts.
 * Once an agent's name/URI is resolved, it stays cached until manually cleared.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, "../data/agent-cache.json");

interface CachedAgent {
  name: string | null;
  uri: string | null;
  isHousePlayer: boolean;
  cachedAt: string;
}

let cache: Record<string, CachedAgent> | null = null;

function loadCache(): Record<string, CachedAgent> {
  if (cache) return cache;
  if (existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
      return cache!;
    } catch {}
  }
  cache = {};
  return cache;
}

function saveCache() {
  if (!cache) return;
  const dir = dirname(CACHE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/** Get cached agent info, or null if not cached */
export function getCachedAgent(address: string): CachedAgent | null {
  const c = loadCache();
  return c[address.toLowerCase()] || null;
}

/** Store agent info in cache */
export function cacheAgent(address: string, info: {
  name: string | null;
  uri: string | null;
  isHousePlayer: boolean;
}) {
  const c = loadCache();
  c[address.toLowerCase()] = {
    ...info,
    cachedAt: new Date().toISOString(),
  };
  saveCache();
}

/** Check if an address is cached */
export function isAgentCached(address: string): boolean {
  return !!getCachedAgent(address);
}
