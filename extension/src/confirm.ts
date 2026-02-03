const amountEl = document.getElementById("amount");
const recipientShortEl = document.getElementById("recipient-short");
const confirmBtn = document.getElementById("confirm");
const headlineEl = document.getElementById("headline");
const descriptionEl = document.getElementById("description");

const params = new URLSearchParams(window.location.search);
const tabId = Number(params.get("tabId"));

const truncate = (value, keep = 6) => {
  if (!value) return "-";
  if (value.length <= keep * 2) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const loadPending = async () => {
  const response = await chrome.runtime.sendMessage({
    type: "getPendingPayment",
    from: "popup",
    tabId
  });
  if (response?.ok && response.pending) {
    amountEl.textContent = `$${response.pending.amount}`;
    recipientShortEl.textContent = truncate(response.pending.recipient, 6);
    headlineEl.textContent = "I can pay this for you.";
    if (descriptionEl) {
      descriptionEl.textContent =
        response.pending.description ?? "x402 Payment Required";
    }
  } else {
    confirmBtn.disabled = true;
  }
};

confirmBtn.addEventListener("click", async () => {
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Paying...";
  const response = await chrome.runtime.sendMessage({
    type: "confirmPendingPayment",
    from: "popup",
    tabId
  });
  if (response?.ok) {
    confirmBtn.textContent = "Paid";
    setTimeout(() => window.close(), 1200);
  } else {
    confirmBtn.textContent = "Confirm";
    confirmBtn.disabled = false;
  }
});

loadPending();
