import { useState, useEffect } from "react";

const AGENT_API =
  import.meta.env.VITE_AGENT_API_URL || "http://localhost:3000";

// ============ Types ============

export interface RaffleInfo {
  address: string;
  state: string;
  totalPool: string;
  participants: string;
  closesAt: string;
  name: string | null;
  type: "house" | "community" | null;
  coverImage: string | null;
}

export interface CurrentRaffle extends RaffleInfo {
  ticketPrice: string;
}

// ============ Hooks ============

/** Fetch the current house raffle from the agent API */
export function useCurrentRaffle(refreshMs = 10_000) {
  const [data, setData] = useState<CurrentRaffle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchCurrent() {
      try {
        const res = await fetch(`${AGENT_API}/api/raffles/current`);
        const json = await res.json();
        if (!cancelled) {
          setData(json.current || null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCurrent();
    const interval = setInterval(fetchCurrent, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshMs]);

  return { data, loading };
}

/** Fetch all active raffles from the agent API */
export function useActiveRafflesApi(refreshMs = 15_000) {
  const [data, setData] = useState<RaffleInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRaffles() {
      try {
        const res = await fetch(`${AGENT_API}/api/raffles`);
        const json = await res.json();
        if (!cancelled) {
          setData(json.raffles || []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRaffles();
    const interval = setInterval(fetchRaffles, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshMs]);

  return { data, loading };
}

/** Fetch agent health info */
export function useAgentHealth() {
  const [data, setData] = useState<{
    status: string;
    agent: string;
    currentVault: string | null;
    chainId: number;
  } | null>(null);

  useEffect(() => {
    fetch(`${AGENT_API}/api/health`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  return data;
}
