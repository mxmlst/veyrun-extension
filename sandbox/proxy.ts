import { paymentProxy } from "@x402/next";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const payTo = process.env.X402_PAY_TO ?? "0x09b84e3a3140ecbd4eed8cf184126ab256b5a2a0";
const price = process.env.X402_PRICE ?? "$0.001";
const network = process.env.X402_NETWORK ?? "eip155:84532";
const facilitatorUrl =
  process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);

export const proxy = paymentProxy(
  {
    "/api/protected/article": {
      accepts: [
        {
          scheme: "exact",
          price,
          network,
          payTo
        }
      ],
      description: "Access to premium article",
      mimeType: "application/json"
    },
    "/api/protected/download": {
      accepts: [
        {
          scheme: "exact",
          price,
          network,
          payTo
        }
      ],
      description: "Access to premium download",
      mimeType: "application/json"
    }
  },
  server
);

export const config = {
  matcher: ["/api/protected/:path*"]
};