/**
 * HD wallet management for house players.
 * Derives player wallets from a single BIP-39 mnemonic using standard derivation paths.
 * Mnemonic stored encrypted on disk. Individual keys derived on-the-fly.
 */

import { mnemonicToAccount, generateMnemonic, english } from "viem/accounts";
import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
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

// ============ Encryption ============

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

// ============ Mnemonic management ============

/** Generate a new mnemonic and save it encrypted */
export function initSeed(password: string): string {
  ensureDataDir();
  if (existsSync(MNEMONIC_FILE)) {
    throw new Error("Seed already exists. Delete data/seed.enc to regenerate.");
  }
  const mnemonic = generateMnemonic(english);
  const encrypted = encrypt(mnemonic, password);
  writeFileSync(MNEMONIC_FILE, encrypted, { mode: 0o600 });
  console.log("Seed generated and encrypted. Back up your mnemonic securely:");
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

// ============ Player derivation ============

/** Standard derivation path for player N: m/44'/60'/0'/0/N */
function derivationPath(index: number): string {
  return `m/44'/60'/0'/0/${index}`;
}

/** Get a player's account (address + signing capability) */
export function getPlayerAccount(mnemonic: string, index: number) {
  return mnemonicToAccount(mnemonic, { addressIndex: index });
}

/** Get a player's address without full account (cheaper) */
export function getPlayerAddress(mnemonic: string, index: number): Address {
  const account = mnemonicToAccount(mnemonic, { addressIndex: index });
  return account.address;
}

/** Get a wallet client for a specific player */
export function getPlayerWalletClient(
  mnemonic: string,
  index: number,
  chain: Chain,
  rpcUrl: string
) {
  const account = mnemonicToAccount(mnemonic, { addressIndex: index });
  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

/** Get addresses for players 0..count-1 */
export function getPlayerAddresses(mnemonic: string, count: number): { index: number; address: Address }[] {
  const result: { index: number; address: Address }[] = [];
  for (let i = 0; i < count; i++) {
    result.push({ index: i, address: getPlayerAddress(mnemonic, i) });
  }
  return result;
}
