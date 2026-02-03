import { HEADER_PAYMENT_REQUIRED } from "@veyrun/shared";

type Message =
  | { type: "ping"; from: "content" }
  | { type: "getStatus"; from: "popup" };

type Status = {
  lastPingAt: number | null;
  lastPaymentRequiredHeader: string | null;
};

const status: Status = {
  lastPingAt: null,
  lastPaymentRequiredHeader: null
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("Veyrun extension installed");
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === "ping") {
    status.lastPingAt = Date.now();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "getStatus") {
    sendResponse({
      ok: true,
      status: {
        ...status,
        headerName: HEADER_PAYMENT_REQUIRED
      }
    });
    return true;
  }

  return false;
});