import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://raffletime:raffletime_dev@localhost:5432/raffletime";

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ============ Agents ============

export async function upsertAgent(agent: {
  address: string;
  agentId?: number;
  name?: string | null;
  uri?: string | null;
  isHouse?: boolean;
  registered?: boolean;
  bondAmount?: string;
}) {
  await pool.query(
    `INSERT INTO agents (address, agent_id, name, uri, is_house, registered, bond_amount, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (address) DO UPDATE SET
       agent_id = COALESCE($2, agents.agent_id),
       name = COALESCE($3, agents.name),
       uri = COALESCE($4, agents.uri),
       is_house = COALESCE($5, agents.is_house),
       registered = COALESCE($6, agents.registered),
       bond_amount = COALESCE($7, agents.bond_amount),
       updated_at = now()`,
    [
      agent.address.toLowerCase(),
      agent.agentId || null,
      agent.name || null,
      agent.uri || null,
      agent.isHouse ?? null,
      agent.registered ?? null,
      agent.bondAmount || null,
    ]
  );
}

export async function getAgent(address: string) {
  const { rows } = await pool.query(
    "SELECT * FROM agents WHERE address = $1",
    [address.toLowerCase()]
  );
  return rows[0] || null;
}

export async function getAllAgents() {
  const { rows } = await pool.query(
    "SELECT * FROM agents ORDER BY created_at DESC"
  );
  return rows;
}

// ============ Raffles ============

export async function upsertRaffle(raffle: {
  vault: string;
  name?: string;
  type?: string;
  state?: string;
  pool?: string;
  participants?: number;
  ticketPrice?: string;
  closesAt?: Date;
  settledAt?: Date;
  coverImage?: string;
  creator?: string;
  vrfRequestId?: string;
  drawTx?: string;
}) {
  await pool.query(
    `INSERT INTO raffles (vault, name, type, state, pool, participants, ticket_price, closes_at, settled_at, cover_image, creator, vrf_request_id, draw_tx, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     ON CONFLICT (vault) DO UPDATE SET
       name = COALESCE($2, raffles.name),
       type = COALESCE($3, raffles.type),
       state = COALESCE($4, raffles.state),
       pool = COALESCE($5, raffles.pool),
       participants = COALESCE($6, raffles.participants),
       ticket_price = COALESCE($7, raffles.ticket_price),
       closes_at = COALESCE($8, raffles.closes_at),
       settled_at = COALESCE($9, raffles.settled_at),
       cover_image = COALESCE($10, raffles.cover_image),
       creator = COALESCE($11, raffles.creator),
       vrf_request_id = COALESCE($12, raffles.vrf_request_id),
       draw_tx = COALESCE($13, raffles.draw_tx),
       updated_at = now()`,
    [
      raffle.vault.toLowerCase(),
      raffle.name || null,
      raffle.type || null,
      raffle.state || null,
      raffle.pool || null,
      raffle.participants ?? null,
      raffle.ticketPrice || null,
      raffle.closesAt || null,
      raffle.settledAt || null,
      raffle.coverImage || null,
      raffle.creator || null,
      raffle.vrfRequestId || null,
      raffle.drawTx || null,
    ]
  );
}

export async function getRaffle(vault: string) {
  const { rows } = await pool.query(
    "SELECT * FROM raffles WHERE vault = $1",
    [vault.toLowerCase()]
  );
  return rows[0] || null;
}

export async function getAllRaffles(limit = 20) {
  const { rows } = await pool.query(
    "SELECT * FROM raffles ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}

export async function getRafflesByState(state: string) {
  const { rows } = await pool.query(
    "SELECT * FROM raffles WHERE state = $1 ORDER BY created_at DESC",
    [state]
  );
  return rows;
}

// ============ Entries ============

export async function recordEntry(vault: string, agent: string, tickets: number) {
  // Upsert — if agent already entered this raffle, update ticket count
  const existing = await pool.query(
    "SELECT id, tickets FROM raffle_entries WHERE vault = $1 AND agent = $2",
    [vault.toLowerCase(), agent.toLowerCase()]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      "UPDATE raffle_entries SET tickets = $1 WHERE id = $2",
      [tickets, existing.rows[0].id]
    );
  } else {
    await pool.query(
      "INSERT INTO raffle_entries (vault, agent, tickets) VALUES ($1, $2, $3)",
      [vault.toLowerCase(), agent.toLowerCase(), tickets]
    );
  }
}

export async function getEntriesForRaffle(vault: string) {
  const { rows } = await pool.query(
    `SELECT e.agent, e.tickets, a.name, a.is_house, a.uri
     FROM raffle_entries e
     LEFT JOIN agents a ON e.agent = a.address
     WHERE e.vault = $1
     ORDER BY e.entered_at`,
    [vault.toLowerCase()]
  );
  return rows;
}

// ============ Results ============

export async function recordResult(
  vault: string,
  winner: string,
  winnerName: string | null,
  prize: string,
  vrf?: { requestId: string; seed: string; fulfillmentTx: string }
) {
  await pool.query(
    `INSERT INTO raffle_results (vault, winner, winner_name, prize, settled_at, vrf_request_id, vrf_seed, vrf_fulfillment_tx)
     VALUES ($1, $2, $3, $4, now(), $5, $6, $7)
     ON CONFLICT (vault) DO UPDATE SET
       winner = $2, winner_name = $3, prize = $4, settled_at = now(),
       vrf_request_id = COALESCE($5, raffle_results.vrf_request_id),
       vrf_seed = COALESCE($6, raffle_results.vrf_seed),
       vrf_fulfillment_tx = COALESCE($7, raffle_results.vrf_fulfillment_tx)`,
    [vault.toLowerCase(), winner.toLowerCase(), winnerName, prize,
     vrf?.requestId || null, vrf?.seed || null, vrf?.fulfillmentTx || null]
  );
}

export async function getResult(vault: string) {
  const { rows } = await pool.query(
    "SELECT * FROM raffle_results WHERE vault = $1",
    [vault.toLowerCase()]
  );
  return rows[0] || null;
}

// ============ Utility ============

export async function query(sql: string, params?: any[]) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function close() {
  await pool.end();
}
