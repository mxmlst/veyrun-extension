import { createPublicClient, decodeEventLog, erc20Abi, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export type VerifyRequest = {
  txHash: string;
  amount: string;
  recipient: string;
  resource?: string;
};

export type VerifiedReceipt = {
  receiptId: string;
  amount: string;
  asset: string;
  timestamp: string;
  proof: string;
  merchantId: string;
  resource: string;
};

export const verifyPayment = async (payload: VerifyRequest) => {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org")
  });

  const receipt = await client.getTransactionReceipt({
    hash: payload.txHash as `0x${string}`
  });

  if (receipt.status !== "success") {
    throw new Error("Transaction failed");
  }

  const expected = parseUnits(payload.amount, 6);
  const recipient = payload.recipient.toLowerCase();

  const matched = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== USDC_BASE_SEPOLIA.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics
      });
      if (decoded.eventName !== "Transfer") return false;
      const to = (decoded.args as { to: string }).to.toLowerCase();
      const value = (decoded.args as { value: bigint }).value;
      return to === recipient && value === expected;
    } catch {
      return false;
    }
  });

  if (!matched) {
    throw new Error("No matching transfer found");
  }

  return {
    receiptId: `rcpt_${payload.txHash.slice(2, 10)}`,
    amount: payload.amount,
    asset: "USDC",
    timestamp: new Date().toISOString(),
    proof: payload.txHash,
    merchantId: payload.recipient,
    resource: payload.resource ?? "unknown"
  } satisfies VerifiedReceipt;
};