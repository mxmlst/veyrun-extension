# Ozentti Sandbox (Next.js App Router)

Deterministic 402 endpoints for testing the Veyrun extension unlock flow.

## Run

```bash
pnpm dev
```

Open http://localhost:3000

## Routes

- `/` catalog of paywalled resources
- `/article` client page that hits the protected article endpoint
- `/download` client page that hits the protected download endpoint

## API (App Router)

- `GET /api/protected/article`
  - 402 with `Payment-Required` header unless `Payment-Signature: mock-signature`
  - 200 with `Payment-Response` header when paid
- `GET /api/protected/download`
  - 402 with `Payment-Required` header unless `Payment-Signature: mock-signature`
  - 200 with `Payment-Response` header when paid
- `POST /api/payments/mock/verify`
  - Body: `{ "signature": "mock-signature", "resource": "/article", "amount": "1.00" }`
  - Returns receipt JSON when valid

## Mock Signature

Use header `Payment-Signature: mock-signature` to unlock protected endpoints.