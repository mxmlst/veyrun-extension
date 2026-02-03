import { HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT_RESPONSE, PaymentRequired, PaymentResponse } from "@veyrun/shared";

export const MOCK_SIGNATURE = "mock-signature";

export function buildPaymentRequiredHeader(options: {
  amount: string;
  nonce: string;
  asset?: string;
  chain?: string;
  recipient?: string;
  expiresInMinutes?: number;
}) {
  const payload: PaymentRequired = {
    version: "0.1",
    accepts: [
      {
        asset: options.asset ?? "USDC",
        amount: options.amount,
        chain: options.chain ?? "skale",
        recipient: options.recipient ?? "demo-wallet",
        nonce: options.nonce,
        expiresAt: new Date(
          Date.now() + (options.expiresInMinutes ?? 10) * 60 * 1000
        ).toISOString()
      }
    ]
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return { header: HEADER_PAYMENT_REQUIRED, value: encoded };
}

export function buildPaymentResponseHeader(options: {
  resource: string;
  amount: string;
  asset?: string;
  merchantId?: string;
}) {
  const receipt: PaymentResponse = {
    receiptId: `rcpt_${Math.random().toString(36).slice(2, 10)}`,
    amount: options.amount,
    asset: options.asset ?? "USDC",
    timestamp: new Date().toISOString(),
    proof: "mock-proof",
    merchantId: options.merchantId ?? "ozentti",
    resource: options.resource
  };

  const encoded = Buffer.from(JSON.stringify(receipt)).toString("base64");
  return { header: HEADER_PAYMENT_RESPONSE, value: encoded, receipt };
}

export function isValidSignature(signature: string | null) {
  return signature === MOCK_SIGNATURE;
}