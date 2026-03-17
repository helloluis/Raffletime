import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from "wagmi";
import { formatEther, type Address, encodePacked, keccak256 } from "viem";
import { contracts } from "./config";
import {
  RaffleVaultAbi,
  RaffleRegistryAbi,
  ERC20Abi,
  AgentRegistryAbi,
} from "./abis";

// ============ Registry hooks ============

export function useActiveRaffles() {
  const isConfigured = contracts.registry !== "0x";
  return useReadContract({
    address: contracts.registry,
    abi: RaffleRegistryAbi,
    functionName: "getActiveRaffles",
    query: { enabled: isConfigured, refetchInterval: 15_000 },
  });
}

export function useRaffleCount() {
  const isConfigured = contracts.registry !== "0x";
  return useReadContract({
    address: contracts.registry,
    abi: RaffleRegistryAbi,
    functionName: "getRaffleCount",
    query: { enabled: isConfigured },
  });
}

// ============ Vault hooks ============

export function useRaffleState(vault: Address | undefined) {
  return useReadContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "state",
    query: { enabled: !!vault, refetchInterval: 10_000 },
  });
}

export function useRaffleDetails(vault: Address | undefined) {
  const addr = vault ?? ("0x0000000000000000000000000000000000000000" as Address);
  return useReadContracts({
    contracts: [
      { address: addr, abi: RaffleVaultAbi, functionName: "state" },
      { address: addr, abi: RaffleVaultAbi, functionName: "totalPool" },
      { address: addr, abi: RaffleVaultAbi, functionName: "closesAt" },
      { address: addr, abi: RaffleVaultAbi, functionName: "getCommitmentCount" },
      { address: addr, abi: RaffleVaultAbi, functionName: "getParticipantCount" },
      { address: addr, abi: RaffleVaultAbi, functionName: "uniqueParticipantCount" },
      { address: addr, abi: RaffleVaultAbi, functionName: "getWinners" },
      { address: addr, abi: RaffleVaultAbi, functionName: "winningBeneficiary" },
      { address: addr, abi: RaffleVaultAbi, functionName: "creator" },
      { address: addr, abi: RaffleVaultAbi, functionName: "getBeneficiaryOptions" },
      { address: addr, abi: RaffleVaultAbi, functionName: "params" },
    ],
    query: { enabled: !!vault, refetchInterval: 10_000 },
  });
}

export function useRaffleWinners(vault: Address | undefined) {
  return useReadContract({
    address: vault,
    abi: RaffleVaultAbi,
    functionName: "getWinners",
    query: { enabled: !!vault },
  });
}

// ============ Token hooks ============

export function useCusdBalance(address: Address | undefined) {
  return useReadContract({
    address: contracts.paymentToken,
    abi: ERC20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

export function useCusdAllowance(
  owner: Address | undefined,
  spender: Address | undefined
) {
  return useReadContract({
    address: contracts.paymentToken,
    abi: ERC20Abi,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: !!owner && !!spender, refetchInterval: 10_000 },
  });
}

// ============ Write hooks ============

export function useApproveToken() {
  return useWriteContract();
}

export function useEnterRaffle() {
  return useWriteContract();
}

// ============ Event watching ============

export function useWatchRaffleEvents(
  vault: Address | undefined,
  onStateChange?: (from: number, to: number) => void
) {
  useWatchContractEvent({
    address: vault,
    abi: RaffleVaultAbi,
    eventName: "StateTransition",
    enabled: !!vault,
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as any).args;
        if (args && onStateChange) {
          onStateChange(Number(args.from), Number(args.to));
        }
      }
    },
  });
}

// ============ Agent hooks ============

export function useTotalAgents() {
  const isConfigured = contracts.agentRegistry !== "0x";
  return useReadContract({
    address: contracts.agentRegistry,
    abi: AgentRegistryAbi,
    functionName: "totalAgents",
    query: { enabled: isConfigured },
  });
}

// ============ Helpers ============

export function generateCommitment(
  vaultAddress: Address,
  participantAddress: Address,
  salt: `0x${string}`
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["address", "address", "bytes32"],
      [vaultAddress, participantAddress, salt]
    )
  );
}

export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export const RAFFLE_STATES = [
  "UNINITIALIZED",
  "OPEN",
  "CLOSED",
  "DRAWING",
  "PAYOUT",
  "SETTLED",
  "INVALID",
] as const;

export { useWaitForTransactionReceipt };

export function formatPool(value: bigint | undefined): string {
  if (value === undefined) return "0.00";
  return formatEther(value);
}

export function formatUsd6(value: bigint | undefined): string {
  if (value === undefined) return "$0.00";
  return `$${(Number(value) / 1e6).toFixed(2)}`;
}
