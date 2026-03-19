/**
 * HD wallet management powered by Tether WDK.
 * Player wallets are derived from a single BIP-39 mnemonic using WDK's
 * index-based derivation. The mnemonic is stored encrypted on disk.
 */

import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { mnemonicToAccount } from "viem/accounts";
import { createWalletClient, http, type Address, type WalletClient, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const MNEMONIC_FILE = resolve(DATA_DIR, "seed.enc");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ============ Encryption (unchanged — compatible with existing seeds) ============

function encrypt(text: string, password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return salt.toString("hex") + ":" + iv.toString("hex") + ":" + encrypted;
}

function decrypt(data: string, password: string): string {
  const [saltHex, ivHex, encrypted] = data.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ============ Seed management ============

/** Generate a new mnemonic using WDK and save it encrypted */
export function initSeed(password: string): string {
  ensureDataDir();
  if (existsSync(MNEMONIC_FILE)) {
    throw new Error("Seed already exists. Delete data/seed.enc to regenerate.");
  }
  const mnemonic = WDK.getRandomSeedPhrase();
  const encrypted = encrypt(mnemonic, password);
  writeFileSync(MNEMONIC_FILE, encrypted, { mode: 0o600 });
  console.log("WDK seed generated and encrypted. Back up your mnemonic securely:");
  console.log(`  ${mnemonic}`);
  return mnemonic;
}

/** Load the mnemonic from encrypted storage */
export function loadSeed(password: string): string {
  if (!existsSync(MNEMONIC_FILE)) {
    throw new Error("No seed found. Run 'init' first.");
  }
  const encrypted = readFileSync(MNEMONIC_FILE, "utf-8");
  return decrypt(encrypted, password);
}

/** Check if seed exists */
export function seedExists(): boolean {
  return existsSync(MNEMONIC_FILE);
}

// ============ WDK instance ============

/** Create a WDK instance registered for EVM (Base) */
export function createWdk(mnemonic: string, rpcUrl: string, _chainId: number): WDK {
  // WalletManagerEvm expects { provider: rpcUrl } — the RPC URL is the provider string
  return (new WDK(mnemonic) as any)
    .registerWallet("evm", WalletManagerEvm, { provider: rpcUrl }) as WDK;
}

/** Get a WDK account for a player by index (index-based HD derivation) */
export async function getWdkAccount(wdk: WDK, index: number) {
  return (wdk as any).getAccount("evm", index);
}

// ============ Address helpers (viem — cheap, no RPC needed) ============

/** Get a player's address without spinning up a full WDK instance */
export function getPlayerAddress(mnemonic: string, index: number): Address {
  return mnemonicToAccount(mnemonic, { addressIndex: index }).address;
}

/** Get addresses for players 0..count-1 */
export function getPlayerAddresses(mnemonic: string, count: number): { index: number; address: Address }[] {
  const result: { index: number; address: Address }[] = [];
  for (let i = 0; i < count; i++) {
    result.push({ index: i, address: getPlayerAddress(mnemonic, i) });
  }
  return result;
}

// Cache wallet clients per index to preserve nonceManager state across sequential TXs
const _walletClientCache = new Map<string, WalletClient>();

/**
 * Get a viem wallet client for a player — uses nonceManager so sequential
 * approve+enter TXs don't collide. Cached per (mnemonic+index) pair.
 */
export function getPlayerWalletClient(
  mnemonic: string,
  index: number,
  rpcUrl: string,
  chainId: number
): WalletClient {
  const cacheKey = `${index}:${rpcUrl}`;
  if (_walletClientCache.has(cacheKey)) return _walletClientCache.get(cacheKey)!;

  const chain: Chain = chainId === 8453
    ? { ...base, rpcUrls: { default: { http: [rpcUrl] } } }
    : { ...baseSepolia, rpcUrls: { default: { http: [rpcUrl] } } };

  const account = mnemonicToAccount(mnemonic, { addressIndex: index });
  const client = createWalletClient({ account, chain, transport: http(rpcUrl) });
  _walletClientCache.set(cacheKey, client);
  return client;
}
