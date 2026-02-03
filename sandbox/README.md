# Ozentti Sandbox (Next.js App Router)

Deterministic x402 endpoints for testing the Veyrun extension unlock flow using a Base Sepolia USDC transfer.

## Run

```bash
pnpm dev
```

Open http://localhost:3000

## x402 Seller Setup (proxy.ts)

The seller flow is implemented in `proxy.ts` using the official x402 packages:
- `@x402/next` for the Next.js proxy
- `@x402/core/server` for the resource server
- `@x402/evm/exact/server` for the EVM exact scheme

Environment defaults:
- `X402_PAY_TO=0x09b84e3a3140ecbd4eed8cf184126ab256b5a2a0`
- `X402_PRICE=$0.001`
- `X402_NETWORK=eip155:84532`
- `X402_FACILITATOR_URL=https://x402.org/facilitator`

## Routes

- `/` catalog of paywalled resources
- `/article` paywalled article with blur until verified payment
- `/download` paywalled download with token after verified payment

## API (App Router)

- `GET /api/protected/article`
- `GET /api/protected/download`

The protected API routes return content directly. The x402 proxy handles payment gating.

## Veyrun Button Integration

The sandbox pages use a Veyrun bridge to sync the page with the extension:

1. Page fetches a protected endpoint. If 402, it reads the `Payment-Required` header.
2. When the user clicks the pay button, the page posts a message:

```js
window.postMessage({
  source: "veyrun-page",
  type: "VEYRUN_PAY",
  payload: { requirement, url: "/api/protected/article", method: "GET" }
}, "*")
```

3. The extension content script listens and replies with:
   - `VEYRUN_READY` (for UI state)
   - `VEYRUN_PENDING` (prompts the user to confirm in the extension)
   - `VEYRUN_PAID` (with `txHash`)
   - `VEYRUN_ERROR` (error message)

4. After the on-chain payment is confirmed, the page retries the protected endpoint.