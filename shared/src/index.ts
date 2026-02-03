export type PaymentAsset = "USDC" | string;

export type PaymentRequired = {
  version: string;
  accepts: Array<{
    asset: PaymentAsset;
    amount: string;
    chain: string;
    recipient: string;
    nonce: string;
    expiresAt: string;
  }>;
};

export type PaymentResponse = {
  receiptId: string;
  amount: string;
  asset: PaymentAsset;
  timestamp: string;
  proof: string;
  merchantId: string;
  resource: string;
};

export const HEADER_PAYMENT_REQUIRED = "Payment-Required";
export const HEADER_PAYMENT_SIGNATURE = "Payment-Signature";
export const HEADER_PAYMENT_RESPONSE = "Payment-Response";