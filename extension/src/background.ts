import { HEADER_PAYMENT_REQUIRED } from "@veyrun/shared";
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
  | { type: "confirmPendingPayment"; from: "popup"; tabId: number };

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
};

const TTL_MS = 5 * 60 * 1000;
const PAY_COOLDOWN_MS = 30 * 1000;
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
        return JSON.parse(raw) as { version?: string; accepts?: X402Accept[] };
      }
      return JSON.parse(decodeBase64(raw)) as {
        version?: string;
        accepts?: X402Accept[];
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
        return normalizeAccept(resolved);
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
    const decoded = decodeBase64(value);
    return JSON.parse(decoded) as Omit<ReceiptRecord, "url">;
  } catch {
    return null;
  }
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
    await chrome.action.setBadgeText({ tabId, text: "1" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#111827" });
  } else {
    await chrome.action.setBadgeText({ tabId, text: "" });
  }
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("Veyrun extension installed");
  ensureWallet();
});

chrome.runtime.onStartup?.addListener(() => {
  ensureWallet();
});

chrome.webRequest.onHeadersReceived.addListener(
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
  ["responseHeaders", "extraHeaders"],
);

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadgeForTab(activeInfo.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  eventsByTab.delete(tabId);
  pendingByTab.delete(tabId);
});

chrome.runtime.onMessage.addListener(
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
          };

          const stored = await chrome.storage.local.get(RECEIPT_KEY);
          const receipts = (stored?.[RECEIPT_KEY] as ReceiptRecord[]) ?? [];
          receipts.unshift(result);
          await chrome.storage.local.set({ [RECEIPT_KEY]: receipts });

          sendResponse({ ok: true, receipt: result, data });
        })
        .catch((error: Error) =>
          sendResponse({ ok: false, error: error.message }),
        );
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
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "Veyrun payment pending",
        message: "Open the Veyrun extension to confirm payment.",
      });
      const confirmUrl = chrome.runtime.getURL(`confirm.html?tabId=${tabId}`);
      chrome.windows.create(
        {
          url: confirmUrl,
          type: "popup",
          width: 360,
          height: 500,
        },
        () => {
          if (chrome.runtime.lastError) {
            chrome.tabs.create({ url: confirmUrl });
          }
        },
      );
      sendResponse({ ok: true, pending: true });
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
          chrome.tabs.sendMessage(message.tabId, {
            type: "paymentResult",
            ok: true,
            receipt,
            data,
          });
          sendResponse({ ok: true, receipt, data });
        })
        .catch((error: Error) => {
          chrome.tabs.sendMessage(message.tabId, {
            type: "paymentResult",
            ok: false,
            error: error.message,
          });
          sendResponse({ ok: false, error: error.message });
        });
      return true;
    }

    return false;
  },
);
