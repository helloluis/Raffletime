/**
 * WebSocket broadcast hub.
 * Server pushes explicit typed events — clients are dumb renderers.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";

// ============ Event types ============

export type WsEvent =
  | { type: "tick"; vault: string; pool: string; participants: string; closesAt: number; name: string; ticketPrice: string }
  | { type: "phase"; phase: string; winner?: { address: string; name: string | null; prize: string } | null }
  | { type: "new_raffle"; vault: string; name: string; closesAt: number; ticketPrice: string; raffleType: string }
  | { type: "settled"; vault: string; name: string; pool: string; participants: string; winner: string | null; winnerName: string | null; prize: string; state: string; ended: string };

// ============ Hub ============

const clients = new Set<WebSocket>();
let lastTick: string = "";
let lastPhase: string = "";

export function initWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    // Send last known state immediately so new clients aren't blank
    if (lastTick) ws.send(lastTick);
    if (lastPhase) ws.send(lastPhase);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  console.log("[ws] WebSocket server ready on /ws");
}

export function broadcast(event: WsEvent): void {
  const json = JSON.stringify(event);

  // Cache last tick and phase for new connections
  if (event.type === "tick") lastTick = json;
  if (event.type === "phase") lastPhase = json;

  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    } else {
      clients.delete(ws);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
