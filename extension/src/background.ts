import { HEADER_PAYMENT_REQUIRED } from "@veyrun/shared";
import browser from "webextension-polyfill";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import {
  createWallet,
  ensureWallet,
  getAccount,
  getChain,
  getPrivateKey,
  getStatus,
  getUsdcBalance,
  importWallet,
  signPayload,
} from "./wallet";

type Message =
  | { type: "ping"; from: "content" }
  | { type: "getLastEvent"; from: "popup"; tabId: number }
  | { type: "parsePaymentRequired"; from: "debug"; value: string }
  | { type: "walletStatus"; from: "popup" }
  | { type: "walletCreate"; from: "popup" }
  | { type: "walletImport"; from: "popup"; privateKey: string }
  | { type: "walletGetPrivateKey"; from: "popup" }
  | { type: "walletSign"; from: "popup"; payload: string }
  | { type: "walletChain"; from: "popup" }
  | { type: "walletUsdcBalance"; from: "popup"; address: string }
  | { type: "payWithVeyrun"; from: "popup"; tabId: number }
  | {
      type: "payWithVeyrunDirect";
      from: "content";
      requirement: PaymentRequiredPayload["accepts"][number];
      url: string;
      method?: string;
    }
  | { type: "getPendingPayment"; from: "popup"; tabId: number }
  | { type: "confirmPendingPayment"; from: "popup"; tabId: number }
  | { type: "getReceipts"; from: "popup" }
  | { type: "reunlockWithReceipt"; from: "popup"; receipt: ReceiptRecord }
  | { type: "openTopup"; from: "confirm" };

const actionApi = (browser as any).action ?? (browser as any).browserAction;

type PaymentRequiredPayload = {
  version: string;
  accepts: Array<{
    asset: string;
    amount: string;
    chain: string;
    recipient: string;
    nonce: string;
    expiresAt: string;
    description?: string;
  }>;
};

type X402Accept = Partial<{
  price: string;
  network: string;
  payTo: string;
  scheme: string;
  amount: string;
  asset: string;
  extra: { name?: string; decimals?: number };
  recipient: string;
  chain: string;
  nonce: string;
  expiresAt: string;
}>;

const formatBaseUnits = (value: string, decimals: number) => {
  const raw = value.replace(/^0+/, "") || "0";
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals);
  const fracPart = padded.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

const normalizeAccept = (
  accept: X402Accept,
): PaymentRequiredPayload["accepts"][number] | null => {
  if (accept.amount && accept.asset && accept.recipient && accept.chain) {
    return {
      asset: accept.asset.startsWith("0x") ? "USDC" : accept.asset,
      amount: accept.asset.startsWith("0x")
        ? formatBaseUnits(accept.amount, accept.extra?.decimals ?? 6)
        : accept.amount,
      chain: accept.chain,
      recipient: accept.recipient,
      nonce: accept.nonce ?? `x402-${Date.now()}`,
      expiresAt:
        accept.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  if (accept.price && accept.payTo && accept.network) {
    return {
      asset: "USDC",
      amount: accept.price.replace("$", ""),
      chain: accept.network.includes("84532") ? "base-sepolia" : accept.network,
      recipient: accept.payTo,
      nonce: `x402-${Date.now()}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  if (accept.amount && accept.asset && accept.payTo && accept.network) {
    return {
      asset: accept.asset.startsWith("0x") ? "USDC" : accept.asset,
      amount: accept.asset.startsWith("0x")
        ? formatBaseUnits(accept.amount, accept.extra?.decimals ?? 6)
        : accept.amount,
      chain: accept.network.includes("84532") ? "base-sepolia" : accept.network,
      recipient: accept.payTo,
      nonce: `x402-${Date.now()}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  return null;
};

type PaymentEvent = {
  tabId: number;
  url: string;
  method: string;
  timestamp: number;
  requestId: string;
  paymentRequired?: PaymentRequiredPayload | null;
  paymentRequiredRaw?: string | null;
};

type ReceiptRecord = {
  receiptId: string;
  amount: string;
  asset: string;
  timestamp: string;
  proof: string;
  merchantId: string;
  resource: string;
  url: string;
  txHash?: string;
  description?: string;
  transaction?: string;
  network?: string;
  payer?: string;
  success?: boolean;
};

const TTL_MS = 5 * 60 * 1000;
const PAY_COOLDOWN_MS = 3 * 1000;
const eventsByTab = new Map<number, PaymentEvent>();
const recentPayments = new Map<string, number>();
const RECEIPT_KEY = "veyrun_receipts";
const pendingByTab = new Map<
  number,
  PaymentRequiredPayload["accepts"][number] & {
    url: string;
    method?: string;
    description?: string;
  }
>();

const cleanHeaderValue = (value: string) =>
  value.trim().replace(/^\"|\"$/g, "");

const decodeBase64 = (value: string) => {
  const normalized = cleanHeaderValue(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${pad}`);
};

const parsePaymentRequired = (value: string | null) => {
  if (!value) return null;
  try {
    const cleaned = cleanHeaderValue(value);
    const tryParse = (raw: string) => {
      if (raw.startsWith("{")) {
        return JSON.parse(raw) as {
          version?: string;
          accepts?: X402Accept[];
          resource?: { description?: string };
        };
      }
      return JSON.parse(decodeBase64(raw)) as {
        version?: string;
        accepts?: X402Accept[];
        resource?: { description?: string };
      };
    };

    let parsed: { version?: string; accepts?: X402Accept[] } | null = null;
    try {
      parsed = tryParse(cleaned);
    } catch {
      if (cleaned.includes("%")) {
        parsed = tryParse(decodeURIComponent(cleaned));
      }
    }

    if (!parsed?.accepts?.length) return null;
    const description = parsed.resource?.description ?? "x402 Payment Required";
    const normalized = parsed.accepts
      .map((accept) => {
        const resolved: X402Accept = {
          ...accept,
          payTo:
            accept.payTo ??
            (accept as unknown as { pay_to?: string }).pay_to ??
            (accept as unknown as { pay_to_address?: string }).pay_to_address,
          network:
            accept.network ??
            (accept as unknown as { chain?: string }).chain ??
            (accept as unknown as { chain_id?: string }).chain_id,
        };
        const normalizedAccept = normalizeAccept(resolved);
        return normalizedAccept
          ? { ...normalizedAccept, description }
          : null;
      })
      .filter(Boolean) as PaymentRequiredPayload["accepts"];
    if (!normalized.length) return null;
    return { version: parsed.version ?? "0.1", accepts: normalized };
  } catch {
    return null;
  }
};

const parsePaymentResponse = (value: string | null) => {
  if (!value) return null;
  try {
    const cleaned = cleanHeaderValue(value);
    const tryParse = (raw: string) => {
      if (raw.startsWith("{")) {
        return JSON.parse(raw) as Omit<ReceiptRecord, "url">;
      }
      return JSON.parse(decodeBase64(raw)) as Omit<ReceiptRecord, "url">;
    };
    try {
      return tryParse(cleaned);
    } catch {
      if (cleaned.includes("%")) {
        return tryParse(decodeURIComponent(cleaned));
      }
      return null;
    }
  } catch {
    return null;
  }
};

const storeReceipt = async (receipt: ReceiptRecord) => {
  if (receipt.proof === "mock-proof") {
    return;
  }
  const stored = await browser.storage.local.get(RECEIPT_KEY);
  const receipts = (stored?.[RECEIPT_KEY] as ReceiptRecord[]) ?? [];
  const filtered = receipts.filter((item) => item.proof !== "mock-proof");
  filtered.unshift(receipt);
  await browser.storage.local.set({ [RECEIPT_KEY]: filtered });
};

const broadcastPaymentStatus = (payload: {
  tabId?: number;
  ok: boolean;
  receipt?: ReceiptRecord;
  error?: string;
}) => {
  browser.runtime.sendMessage({
    type: "paymentStatus",
    ...payload
  });
};

const executePayment = async (url: string, method = "GET") => {
  const account = await getAccount();
  if (!account) {
    throw new Error("No wallet found.");
  }

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const response = await fetchWithPayment(url, { method });

  if (!response.ok) {
    throw new Error(`Unlock failed (${response.status}).`);
  }

  const httpClient = new x402HTTPClient(client);
  const settle = httpClient.getPaymentSettleResponse((name) =>
    response.headers.get(name),
  );
  const headerValue =
    settle?.paymentResponseHeader ?? response.headers.get("Payment-Response");
  const receipt = parsePaymentResponse(headerValue);
  if (!receipt) {
    throw new Error("Missing receipt.");
  }

  let data: unknown = null;
  try {
    data = await response.clone().json();
  } catch {
    data = null;
  }

  return { receipt, data };
};

const isFresh = (event: PaymentEvent | undefined) =>
  event ? Date.now() - event.timestamp <= TTL_MS : false;

const updateBadgeForTab = async (tabId: number) => {
  const event = eventsByTab.get(tabId);
  if (isFresh(event)) {
    await actionApi.setBadgeText({ tabId, text: "1" });
    await actionApi.setBadgeBackgroundColor({ tabId, color: "#111827" });
  } else {
    await actionApi.setBadgeText({ tabId, text: "" });
  }
};

browser.runtime.onInstalled.addListener(() => {
  console.log("Veyrun extension installed");
  ensureWallet();
});

browser.runtime.onStartup?.addListener(() => {
  ensureWallet();
});

const responseHeadersOptions: any[] = ["responseHeaders"];
if (!("getBrowserInfo" in browser.runtime)) {
  responseHeadersOptions.push("extraHeaders");
}

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.statusCode !== 402 || !details.tabId || details.tabId < 0) {
      return;
    }

    const header = details.responseHeaders?.find(
      (item) =>
        item.name.toLowerCase() === HEADER_PAYMENT_REQUIRED.toLowerCase(),
    );

    const paymentRequiredRaw = header?.value ?? null;
    const paymentRequired = parsePaymentRequired(paymentRequiredRaw);

    const event: PaymentEvent = {
      tabId: details.tabId,
      url: details.url,
      method: details.method ?? "GET",
      timestamp: Date.now(),
      requestId: details.requestId,
      paymentRequired,
      paymentRequiredRaw,
    };

    eventsByTab.set(details.tabId, event);
    updateBadgeForTab(details.tabId);
  },
  { urls: ["<all_urls>"] },
  responseHeadersOptions,
);

browser.tabs.onActivated.addListener((activeInfo) => {
  updateBadgeForTab(activeInfo.tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  eventsByTab.delete(tabId);
  pendingByTab.delete(tabId);
});

browser.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (message.type === "ping") {
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "getLastEvent") {
      const event = eventsByTab.get(message.tabId);
      sendResponse({
        ok: true,
        event: isFresh(event) ? event : null,
      });
      return true;
    }

    if (message.type === "parsePaymentRequired") {
      sendResponse({
        ok: true,
        parsed: parsePaymentRequired(message.value),
      });
      return true;
    }

    if (message.type === "walletStatus") {
      getStatus()
        .then((status) => sendResponse({ ok: true, status }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

    if (message.type === "walletCreate") {
      createWallet()
        .then(() => getStatus())
        .then((status) => sendResponse({ ok: true, status }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

    if (message.type === "walletImport") {
      importWallet(message.privateKey)
        .then(() => getStatus())
        .then((status) => sendResponse({ ok: true, status }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

    if (message.type === "walletGetPrivateKey") {
      getPrivateKey()
        .then((privateKey) => sendResponse({ ok: true, privateKey }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

    if (message.type === "walletSign") {
      signPayload(message.payload)
        .then((signature) => sendResponse({ ok: true, signature }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

    if (message.type === "walletChain") {
      getChain()
        .then((chain) => sendResponse({ ok: true, chain }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

    if (message.type === "walletUsdcBalance") {
      getUsdcBalance(message.address)
        .then((balance) => sendResponse({ ok: true, balance }))
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
      return true;
    }

  if (message.type === "payWithVeyrun") {
      const event = eventsByTab.get(message.tabId);
      if (!isFresh(event)) {
        sendResponse({ ok: false, error: "No recent 402 event." });
        return true;
      }

      const now = Date.now();
      const lastAttempt = recentPayments.get(event.url) ?? 0;
      if (now - lastAttempt < PAY_COOLDOWN_MS) {
        sendResponse({ ok: false, error: "Payment cooldown in effect." });
        return true;
      }

      recentPayments.set(event.url, now);

      const requirement = event.paymentRequired?.accepts?.[0];
      if (!requirement) {
        sendResponse({ ok: false, error: "Missing payment requirement." });
        return true;
      }

    executePayment(event.url, event.method)
      .then(async ({ receipt, data }) => {
        const result: ReceiptRecord = {
          ...receipt,
          url: event.url,
          description: requirement.description,
          amount:
            receipt.amount ??
            requirement.amount ??
            (receipt.network?.includes("84532") ? "0.001" : "unknown"),
          asset: receipt.asset ?? requirement.asset ?? "USDC",
          merchantId: receipt.merchantId ?? requirement.recipient
        };

        await storeReceipt(result);

        broadcastPaymentStatus({ ok: true, receipt: result, tabId: message.tabId });
        sendResponse({ ok: true, receipt: result, data });
      })
      .catch((error: Error) => {
        broadcastPaymentStatus({ ok: false, error: error.message, tabId: message.tabId });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

    if (message.type === "payWithVeyrunDirect") {
      const now = Date.now();
      const lastAttempt = recentPayments.get(message.url) ?? 0;
      if (now - lastAttempt < PAY_COOLDOWN_MS) {
        sendResponse({ ok: false, error: "Payment cooldown in effect." });
        return true;
      }

      recentPayments.set(message.url, now);
      const tabId = sender?.tab?.id;
      if (tabId === undefined) {
        sendResponse({ ok: false, error: "Missing tab." });
        return true;
      }
      pendingByTab.set(tabId, {
        ...message.requirement,
        description: message.requirement.description ?? "x402 Payment Required",
        url: message.url,
        method: message.method,
      });
      browser.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "Veyrun payment pending",
        message: "Open the Veyrun extension to confirm payment.",
      });
      const confirmUrl = browser.runtime.getURL(`confirm.html?tabId=${tabId}`);
      const popupWidth = 360;
      const popupHeight = 500;
      browser.windows
        .getLastFocused()
        .then((win) => {
          const leftBase = win?.left ?? 0;
          const topBase = win?.top ?? 0;
          const widthBase = win?.width ?? 1200;
          const heightBase = win?.height ?? 800;
          const left = Math.max(0, leftBase + widthBase - popupWidth - 20);
          const top = Math.max(0, topBase + heightBase - popupHeight - 40);
          return browser.windows.create({
            url: confirmUrl,
            type: "popup",
            width: popupWidth,
            height: popupHeight,
            left,
            top,
          });
        })
        .catch(() => browser.tabs.create({ url: confirmUrl }))
        .finally(() => {
          sendResponse({ ok: true, pending: true });
        });
      return true;
    }

    if (message.type === "getPendingPayment") {
      const pending = pendingByTab.get(message.tabId) ?? null;
      sendResponse({ ok: true, pending });
      return true;
    }

    if (message.type === "confirmPendingPayment") {
      const pending = pendingByTab.get(message.tabId);
      if (!pending) {
        sendResponse({ ok: false, error: "No pending payment." });
        return true;
      }
    pendingByTab.delete(message.tabId);
    executePayment(pending.url, pending.method)
      .then(({ receipt, data }) => {
        const result: ReceiptRecord = {
          ...receipt,
          url: pending.url,
          description: pending.description,
          amount:
            receipt.amount ??
            pending.amount ??
            (receipt.network?.includes("84532") ? "0.001" : "unknown"),
          asset: receipt.asset ?? pending.asset ?? "USDC",
          merchantId: receipt.merchantId ?? pending.recipient
        };
        browser.tabs.sendMessage(message.tabId, {
          type: "paymentResult",
          ok: true,
          receipt,
          data,
        });
        storeReceipt(result).catch(() => undefined);
        broadcastPaymentStatus({ ok: true, receipt: result, tabId: message.tabId });
        sendResponse({ ok: true, receipt: result, data });
      })
      .catch((error: Error) => {
        browser.tabs.sendMessage(message.tabId, {
          type: "paymentResult",
          ok: false,
          error: error.message,
        });
        broadcastPaymentStatus({ ok: false, error: error.message, tabId: message.tabId });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

    if (message.type === "getReceipts") {
      browser.storage.local
        .get(RECEIPT_KEY)
        .then((stored) => {
          const receipts = (stored?.[RECEIPT_KEY] as ReceiptRecord[]) ?? [];
          const normalized = receipts
            .filter((receipt) => receipt.proof !== "mock-proof")
            .map((receipt) => {
              const withAmount =
                !receipt.amount && receipt.network?.includes("84532")
                  ? { ...receipt, amount: "0.001" }
                  : receipt;
              return {
                ...withAmount,
                asset: withAmount.asset ?? "USDC",
                description: withAmount.description ?? "x402 Payment Required",
              };
            });
          sendResponse({ ok: true, receipts: normalized });
        })
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "openTopup") {
      const topupUrl = browser.runtime.getURL("popup.html?topup=1");
      browser.windows
        .create({ url: topupUrl, type: "popup", width: 360, height: 520 })
        .catch(() => browser.tabs.create({ url: topupUrl }))
        .finally(() => sendResponse({ ok: true }));
      return true;
    }

  if (message.type === "reunlockWithReceipt") {
    const receipt = message.receipt;
    const paymentReceipt = {
      txHash: receipt.proof,
      recipient: receipt.merchantId,
      amount: receipt.amount
    };
    fetch(receipt.url, {
      method: "GET",
      headers: {
        "Payment-Receipt": JSON.stringify(paymentReceipt)
      }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unlock failed (${response.status}).`);
        }
        let data: unknown = null;
        try {
          data = await response.clone().json();
        } catch {
          data = null;
        }
        sendResponse({ ok: true, data });
      })
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

    return false;
  },
);
