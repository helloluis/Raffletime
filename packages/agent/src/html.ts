/**
 * Shared HTML layout for agent-friendly pages.
 * Brutalist / minimal design. Space Mono headings, Noto Sans body,
 * Share Tech Mono for the countdown timer.
 */

export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — RaffleTime</title>
  <meta name="description" content="Zero-loss sybil-resistant agentic raffles. Provably fair. Fully onchain.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Noto+Sans:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Noto Sans', sans-serif;
      background: #908888;
      color: #000;
      min-height: 100vh;
      font-size: 16px;
      line-height: 1.5;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
      padding: 3rem 1.5rem 4rem;
    }

    /* ---- Typography ---- */

    h1, h2, h3 {
      font-family: 'Space Mono', monospace;
      font-weight: 700;
    }

    h1 {
      font-size: 1.1rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }

    .site-title {
      margin-bottom: 0.25rem;
    }
    .site-title span { color: #8b1a11; }

    .site-tagline {
      font-family: 'Space Mono', monospace;
      font-size: 0.9rem;
      color: #ccc;
      margin-bottom: 3rem;
    }

    h2 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: #111;
      color: #fff;
      display: inline-block;
      padding: 4px 10px;
      margin: 3rem 0 1.25rem;
    }

    h3 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8b1a11;
      margin: 1.5rem 0 0.5rem;
    }

    a { color: #8b1a11; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .back-link {
      display: inline-block;
      font-family: 'Space Mono', monospace;
      font-size: 0.85rem;
      margin-bottom: 2rem;
    }

    /* ---- Countdown timer ---- */

    .countdown {
      font-family: 'Share Tech Mono', monospace;
      font-size: 12rem;
      font-weight: 400;
      line-height: 0.85;
      letter-spacing: -0.15em;
      margin: 1rem 0 0.5rem -0.12em;
    }

    .countdown .ms {
      font-size: 3.5rem;
      vertical-align: baseline;
      letter-spacing: 0em;
      padding-left: 1rem;
      color: #000;
    }

    /* ---- Stats ---- */

    .stats {
      font-family: 'Space Mono', monospace;
      font-size: 1.75rem;
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }

    /* ---- Buttons ---- */

    .cta {
      display: inline-block;
      background: #8b1a11;
      color: #fff;
      font-family: 'Space Mono', monospace;
      font-weight: 700;
      font-size: 1.25rem;
      padding: 0.75rem 2rem;
      text-decoration: none;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      transition: background 0.15s;
    }
    .cta:hover { background: #5c110b; text-decoration: none; }

    /* ---- Badges ---- */

    .type-badge {
      display: inline-block;
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 2px 8px;
    }
    .testnet-pill {
      font-family: 'Space Mono', monospace;
      font-size: 0.55rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      background: #999;
      color: #fff;
      padding: 3px 8px;
      vertical-align: middle;
      margin-left: 0.5rem;
    }

    #result-line {
      font-family: 'Space Mono', monospace;
      font-size: 1.25rem;
      margin-top: 0.5rem;
    }

    .spec-pill {
      font-family: 'Space Mono', monospace;
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: #999;
      color: #fff;
      padding: 2px 8px;
      vertical-align: middle;
    }

    .type-badge.house { background: #999; color: #fff; }
    .type-badge.community { background: #8b1a11; color: #fff; }

    /* ---- Info table ---- */

    .info-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    .info-table td {
      padding: 0.5rem 0;
      vertical-align: top;
    }
    .info-table td:first-child {
      font-weight: 600;
      width: 140px;
      color: #000;
    }

    /* ---- Code ---- */

    code {
      font-family: 'Space Mono', monospace;
      font-size: 0.8em;
      background: rgba(0,0,0,0.25);
      padding: 2px 6px;
    }

    pre {
      background: #111;
      color: #eee;
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      padding: 1rem;
      overflow-x: auto;
      margin: 0.75rem 0;
    }
    pre code { background: none; padding: 0; color: inherit; }

    /* ---- Raffle cards ---- */

    .raffle-card {
      padding: 1.25rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.15);
    }
    .raffle-card:last-child { border-bottom: none; }

    .raffle-card .name {
      font-family: 'Space Mono', monospace;
      font-weight: 700;
      font-size: 1.1rem;
    }
    .raffle-card .name a { color: #000; }
    .raffle-card .name a:hover { color: #8b1a11; }

    .raffle-card .meta {
      display: flex;
      gap: 1.5rem;
      margin-top: 0.35rem;
      font-size: 0.9rem;
      color: #333;
      flex-wrap: wrap;
    }

    .state-open { color: #000; font-weight: 600; }
    .state-closed { color: #8b1a11; font-weight: 600; }
    .state-settled { color: #bbb; }

    /* ---- Sections ---- */

    .section {
      margin: 3rem 0;
    }

    /* ---- Lists ---- */

    ul, ol { padding-left: 1.25rem; margin: 0.5rem 0; }
    li { margin: 0.35rem 0; }

    /* ---- Footer ---- */

    .footer {
      margin-top: 4rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(0,0,0,0.15);
      font-size: 0.85rem;
      color: #000;
    }
    .footer a { color: #000; margin-right: 1.5rem; }
    .footer a:hover { color: #8b1a11; }

    /* ---- Empty ---- */

    .empty {
      padding: 2rem 0;
      color: #bbb;
    }

    /* ---- Dramatic timeline animations ---- */

    /* transition set dynamically via JS per phase */

    .cta { transition: background 0.15s, border-color 0.15s, box-shadow 0.15s; }

    .cta-urgent {
      border: 1px solid #fff;
      animation: ctaFlash 1s infinite;
    }

    @keyframes ctaFlash {
      0%, 49% { background: #8b1a11; }
      50%, 100% { background: #111; }
    }

    /* ---- Previous raffles table ---- */

    .prev-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-top: 0.75rem;
    }
    .prev-table th {
      font-family: 'Space Mono', monospace;
      font-weight: 700;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      text-align: left;
      padding: 0.5rem 0.5rem 0.5rem 0;
      color: #555;
    }
    .prev-table td {
      padding: 0.4rem 0.5rem 0.4rem 0;
      vertical-align: top;
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
    }
    .prev-table a { color: inherit; }
    .prev-table a:hover { color: #8b1a11; }

    /* ---- Responsive ---- */

    @media (max-width: 600px) {
      .container { padding: 2rem 1rem; }
      .countdown { font-size: 6rem; }
      .countdown .ms { font-size: 2rem; }
      .stats { font-size: 1.25rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${body}

    <div class="footer">
      <a href="/.well-known/agent.json">Agent Discovery</a>
      <a href="/api/raffles">API</a>
      <a href="https://github.com/helloluis/Raffletime">GitHub</a>
    </div>
  </div>
</body>
</html>`;
}

/** Get block explorer URL for an address */
export function explorerLink(address: string, chainId: number): string {
  const explorers: Record<number, string> = {
    42220: "https://celoscan.io/address/",
    44787: "https://alfajores.celoscan.io/address/",
    11142220: "https://sepolia.celoscan.io/address/",
  };
  const base = explorers[chainId] || "https://sepolia.celoscan.io/address/";
  return `<a href="${base}${address}" target="_blank" style="color:inherit"><code>${address}</code></a>`;
}

/** Format a wei value as a cash price string like "$0.10" */
export function formatPrice(wei: bigint | string): string {
  const eth = typeof wei === "string" ? parseFloat(wei) : parseFloat(wei.toString()) / 1e18;
  return `$${eth.toFixed(2)}`;
}

/** Format an ether string as cash price */
export function formatCash(etherStr: string): string {
  return `$${parseFloat(etherStr).toFixed(2)}`;
}

/** Render a state label with appropriate styling */
export function stateLabel(state: string): string {
  const cls = state === "OPEN" ? "state-open" : state === "SETTLED" ? "state-settled" : "state-closed";
  return `<span class="${cls}">${state}</span>`;
}
