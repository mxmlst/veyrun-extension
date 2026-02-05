import browser from "webextension-polyfill";

const amountEl = document.getElementById("amount");
const recipientShortEl = document.getElementById("recipient-short");
const confirmBtn = document.getElementById("confirm");
const cancelBtn = document.getElementById("cancel");
const headlineEl = document.getElementById("headline");
const descriptionEl = document.getElementById("description");

const params = new URLSearchParams(window.location.search);
const tabId = Number(params.get("tabId"));
let pendingAmount: number | null = null;

const truncate = (value, keep = 6) => {
  if (!value) return "-";
  if (value.length <= keep * 2) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const isInsufficient = (message: string) =>
  /insufficient|balance|funds/i.test(message);

let topupMode = false;

const loadPending = async () => {
  const response = await browser.runtime.sendMessage({
    type: "getPendingPayment",
    from: "popup",
    tabId
  });
  if (response?.ok && response.pending) {
    amountEl.textContent = `$${response.pending.amount}`;
    recipientShortEl.textContent = truncate(response.pending.recipient, 6);
    headlineEl.textContent = "I can pay this for you.";
    pendingAmount = Number(response.pending.amount);
    if (descriptionEl) {
      descriptionEl.textContent =
        response.pending.description ?? "x402 Payment Required";
    }
  } else {
    confirmBtn.disabled = true;
  }
};

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "paymentStatus") return;
  if (typeof tabId === "number" && message.tabId !== tabId) return;
  if (message.ok) {
    confirmBtn.textContent = "Paid";
    setTimeout(() => window.close(), 1200);
  } else if (message.error) {
    if (isInsufficient(message.error)) {
      topupMode = true;
      headlineEl.textContent = "Agent has no balance.";
      if (descriptionEl) {
        descriptionEl.textContent = "Top up to continue the payment.";
      }
      confirmBtn.textContent = "Top up";
      confirmBtn.disabled = false;
    } else {
      confirmBtn.textContent = "Confirm";
      confirmBtn.disabled = false;
    }
  }
});

confirmBtn.addEventListener("click", async () => {
  if (topupMode) {
    await browser.runtime.sendMessage({ type: "openTopup", from: "confirm" });
    window.close();
    return;
  }
  if (pendingAmount !== null && Number.isFinite(pendingAmount)) {
    const statusResponse = await browser.runtime.sendMessage({
      type: "walletStatus",
      from: "popup"
    });
    const address = statusResponse?.ok ? statusResponse.status?.address : null;
    if (address) {
      const balanceResponse = await browser.runtime.sendMessage({
        type: "walletUsdcBalance",
        from: "popup",
        address
      });
      const balanceValue = balanceResponse?.ok
        ? Number(balanceResponse.balance)
        : null;
      if (balanceValue !== null && balanceValue < pendingAmount) {
        topupMode = true;
        headlineEl.textContent = "Agent has no balance.";
        if (descriptionEl) {
          descriptionEl.textContent = "Top up to continue the payment.";
        }
        confirmBtn.textContent = "Top up";
        confirmBtn.disabled = false;
        return;
      }
    }
  }
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Paying...";
  const response = await browser.runtime.sendMessage({
    type: "confirmPendingPayment",
    from: "popup",
    tabId
  });
  if (response?.ok) {
    confirmBtn.textContent = "Paid";
    setTimeout(() => window.close(), 1200);
  } else {
    const error = response?.error ?? "Payment failed.";
    if (isInsufficient(error)) {
      topupMode = true;
      headlineEl.textContent = "Agent has no balance.";
      if (descriptionEl) {
        descriptionEl.textContent = "Top up to continue the payment.";
      }
      confirmBtn.textContent = "Top up";
      confirmBtn.disabled = false;
      return;
    }
    confirmBtn.textContent = "Confirm";
    confirmBtn.disabled = false;
  }
});

cancelBtn?.addEventListener("click", () => {
  browser.runtime.sendMessage({
    type: "confirmCancelled",
    from: "confirm",
    tabId
  });
  window.close();
});

loadPending();
