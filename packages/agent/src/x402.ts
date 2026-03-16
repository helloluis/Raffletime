import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { config } from "./config.js";
import { getAgentAddress } from "./chain.js";

// CAIP-2 network identifier for the configured chain
function getNetwork(): `${string}:${string}` {
  return `eip155:${config.chainId}`;
}

// Facilitator URL — use Coinbase's free hosted facilitator (no API key required)
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

/**
 * Create x402 payment middleware for Hono.
 *
 * Wraps route definitions with x402 payment requirements.
 * When THIRDWEB_SECRET_KEY is not needed — Coinbase's free facilitator
 * handles verification and settlement.
 *
 * In dev/test mode (X402_ENABLED !== "true"), returns null so the
 * caller can skip applying the middleware.
 */
export function createX402Middleware() {
  // Skip x402 if not explicitly enabled (safe for dev/test/MCP)
  if (process.env.X402_ENABLED !== "true") {
    return null;
  }

  const payTo = getAgentAddress();
  const network = getNetwork();

  const facilitatorClient = new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
  });

  const server = new x402ResourceServer(facilitatorClient).register(
    network,
    new ExactEvmScheme()
  );

  const ticketPriceUsd = formatTicketPrice(config.raffle.ticketPriceUsd6);

  return paymentMiddleware(
    {
      "POST /api/raffles/:address/enter": {
        accepts: [
          {
            scheme: "exact",
            price: ticketPriceUsd,
            network,
            payTo,
          },
        ],
        description:
          "Raffle ticket purchase — enter the current raffle via x402 payment",
        mimeType: "application/json",
      },
    },
    server
  );
}

/**
 * Convert wei amount to dollar string for x402 price field.
 * Assumes 18-decimal stablecoin.
 * e.g. 100000000000000000n (0.1 stablecoin) → "$0.1"
 */
function formatTicketPrice(weiAmount: bigint): string {
  const decimals = 18;
  const whole = weiAmount / 10n ** BigInt(decimals);
  const frac = weiAmount % 10n ** BigInt(decimals);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fracStr) {
    return `$${whole}.${fracStr}`;
  }
  return `$${whole}`;
}
