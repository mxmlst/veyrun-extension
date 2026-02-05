import browser from "webextension-polyfill";

type WalletStatus = {
  hasWallet: boolean;
  address: string | null;
  createdAt: number | null;
  chainId: number;
};

type ChainInfo = {
  id: number;
  name: string;
  rpcUrl: string;
};

type PaymentEvent = {
  url: string;
  timestamp: number;
  paymentRequired?: {
    accepts?: Array<{
      amount: string;
      asset: string;
      recipient: string;
      chain?: string;
    }>;
  } | null;
};

type PendingPayment = {
  amount: string;
  asset: string;
  recipient: string;
  chain: string;
  nonce: string;
  url: string;
  method?: string;
  description?: string;
};

type ReceiptRecord = {
  receiptId?: string;
  amount?: string;
  asset?: string;
  timestamp?: string;
  proof?: string;
  merchantId?: string;
  resource?: string;
  url: string;
  description?: string;
  transaction?: string;
  payer?: string;
  network?: string;
  success?: boolean;
  price?: string;
};

const normalizeReceipt = (receipt: ReceiptRecord) => {
  const tx = receipt.proof ?? receipt.transaction ?? null;
  let amount =
    receipt.amount ??
    (receipt.price ? receipt.price.replace("$", "") : undefined) ??
    (receipt.network && receipt.network.includes("84532") ? "0.001" : undefined);
  if (!amount) amount = "unknown";
  const asset = receipt.asset ?? "USDC";
  const description = receipt.description ?? "x402 Payment Required";
  const timestamp = receipt.timestamp ?? "";
  return { tx, amount, asset, description, timestamp };
};

const statusPill = document.getElementById("status-pill") as HTMLElement;
const eventCard = document.getElementById("event-card") as HTMLElement;
const noX402 = document.getElementById("no-x402") as HTMLElement;
const eventEndpoint = document.getElementById("event-endpoint") as HTMLElement;
const eventAmount = document.getElementById("event-amount") as HTMLElement;
const eventRecipient = document.getElementById("event-recipient") as HTMLElement;
const eventTime = document.getElementById("event-time") as HTMLElement;
const pendingRow = document.getElementById("pending-row") as HTMLElement;
const pendingValue = document.getElementById("pending-value") as HTMLElement;
const payButton = document.getElementById("pay-button") as HTMLButtonElement;

const walletAddress = document.getElementById("wallet-address") as HTMLElement;
const walletBalance = document.getElementById("wallet-balance") as HTMLElement;
const walletChain = document.getElementById("wallet-chain") as HTMLElement;
const copyBtn = document.getElementById("copy-address") as HTMLButtonElement;
const viewWalletBtn = document.getElementById("view-wallet") as HTMLButtonElement;
const topupBtn = document.getElementById("topup") as HTMLButtonElement;
const changeAccountBtn = document.getElementById("change-account") as HTMLButtonElement;

const historyList = document.getElementById("history-list") as HTMLElement;
const exportHistoryBtn = document.getElementById("export-history") as HTMLButtonElement;

const modal = document.getElementById("modal") as HTMLElement;
const closeModal = document.getElementById("close-modal") as HTMLButtonElement;
const currentKey = document.getElementById("current-key") as HTMLInputElement;
const newKey = document.getElementById("new-key") as HTMLInputElement;
const saveKey = document.getElementById("save-key") as HTMLButtonElement;

const qrModal = document.getElementById("qr-modal") as HTMLElement;
const closeQr = document.getElementById("close-qr") as HTMLButtonElement;
const qrImage = document.getElementById("qr-image") as HTMLImageElement;
const qrAddress = document.getElementById("qr-address") as HTMLElement;
const copyQr = document.getElementById("copy-qr") as HTMLButtonElement;
const resetWallet = document.getElementById("reset-wallet") as HTMLButtonElement;

let pendingPayment: PendingPayment | null = null;
let receipts: ReceiptRecord[] = [];

const truncate = (value: string, keep = 6) => {
  if (value.length <= keep * 2) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const setStatus = (text: string) => {
  statusPill.textContent = text;
};

const setWalletUI = (
  status: WalletStatus | null,
  chain: ChainInfo | null,
  balance: string | null
) => {
  walletAddress.textContent = status?.address ? truncate(status.address, 6) : "Not set";
  walletBalance.textContent = status?.address ? `${balance ?? "0.00"}` : "-";
  walletChain.textContent = chain ? `${chain.name} (${chain.id})` : "-";
};

const formatAsset = (asset: string) => (asset.startsWith("0x") ? "USDC" : asset);
const getExplorerUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;

const showX402 = (event: PaymentEvent) => {
  eventCard.classList.remove("hidden");
  noX402.classList.add("hidden");
  const url = new URL(event.url);
  eventEndpoint.textContent = `${url.pathname}${url.search}`;
  const accepts = event.paymentRequired?.accepts?.[0];
  const amount = accepts ? `${accepts.amount} ${formatAsset(accepts.asset)}` : "unknown";
  const recipient = accepts?.recipient ?? "unknown";
  eventAmount.textContent = amount;
  eventRecipient.textContent = truncate(recipient, 8);
  eventTime.textContent = new Date(event.timestamp).toLocaleTimeString();
  setStatus("Payment Required");
};

const showNoX402 = () => {
  eventCard.classList.add("hidden");
  noX402.classList.remove("hidden");
  payButton.disabled = true;
  setStatus("Idle");
};

const loadEvent = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showNoX402();
    return null;
  }

  const response = await browser.runtime.sendMessage({
    type: "getLastEvent",
    from: "popup",
    tabId: tab.id
  });

  if (response?.ok && response.event) {
    const event = response.event as PaymentEvent;
    showX402(event);
    return event;
  }

  showNoX402();
  return null;
};

const fetchBalance = async (address: string | null) => {
  if (!address) return null;
  const response = await browser.runtime.sendMessage({
    type: "walletUsdcBalance",
    from: "popup",
    address
  });
  return response?.ok ? (response.balance as string) : null;
};

const loadWalletStatus = async () => {
  const [statusResponse, chainResponse] = await Promise.all([
    browser.runtime.sendMessage({ type: "walletStatus", from: "popup" }),
    browser.runtime.sendMessage({ type: "walletChain", from: "popup" })
  ]);

  const status = statusResponse?.ok ? (statusResponse.status as WalletStatus) : null;
  const chain = chainResponse?.ok ? (chainResponse.chain as ChainInfo) : null;
  const balance = status?.address ? await fetchBalance(status.address) : null;

  setWalletUI(status, chain, balance);
};

const loadPending = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const response = await browser.runtime.sendMessage({
    type: "getPendingPayment",
    from: "popup",
    tabId: tab.id
  });
  pendingPayment = response?.ok ? (response.pending as PendingPayment | null) : null;
  if (pendingPayment) {
    pendingRow.classList.remove("hidden");
    pendingValue.textContent = "Processing";
    payButton.disabled = false;
    payButton.textContent = "Confirm";
    setStatus("Processing");
  } else {
    pendingRow.classList.add("hidden");
    payButton.textContent = "Pay with Veyrun";
  }
};

const renderHistory = () => {
  historyList.innerHTML = "";
  const filtered = receipts;

  if (filtered.length === 0) {
    historyList.textContent = "No receipts yet.";
    return;
  }

  for (const receipt of filtered) {
    const item = document.createElement("div");
    item.className = "history-item";

    const host = document.createElement("div");
    try {
      host.textContent = new URL(receipt.url).hostname;
    } catch {
      host.textContent = "Unknown site";
    }

    const desc = document.createElement("div");
    desc.textContent = receipt.description ?? "x402 Payment Required";

    const normalized = normalizeReceipt(receipt);
    const title = document.createElement("div");
    title.textContent = `${normalized.amount} ${formatAsset(normalized.asset)}${
      normalized.timestamp ? " " + new Date(normalized.timestamp).toLocaleString() : ""
    }`;

    const url = document.createElement("button");
    url.className = "ghost";
    url.textContent = "View";
    url.addEventListener("click", () => {
      if (normalized.tx && normalized.tx.startsWith("0x")) {
        browser.tabs.create({ url: getExplorerUrl(normalized.tx) });
      }
    });

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const view = document.createElement("button");
    view.className = "secondary";
    view.textContent = "View";
    view.addEventListener("click", () => {
      if (normalized.tx && normalized.tx.startsWith("0x")) {
        browser.tabs.create({ url: getExplorerUrl(normalized.tx) });
      }
    });

    actions.appendChild(view);
    item.appendChild(host);
    item.appendChild(desc);
    item.appendChild(title);
    item.appendChild(actions);
    historyList.appendChild(item);
  }

};

const loadHistory = async () => {
  const response = await browser.runtime.sendMessage({
    type: "getReceipts",
    from: "popup"
  });
  receipts = response?.ok ? (response.receipts as ReceiptRecord[]) : [];
  receipts = receipts.filter((receipt) => receipt.proof !== "mock-proof");
  renderHistory();
};

const openModal = async () => {
  const response = await browser.runtime.sendMessage({
    type: "walletGetPrivateKey",
    from: "popup"
  });
  currentKey.value = response?.ok && response.privateKey ? response.privateKey : "";
  newKey.value = "";
  modal.classList.remove("hidden");
};

const closeModalUI = () => {
  modal.classList.add("hidden");
};

const openQr = async () => {
  const response = await browser.runtime.sendMessage({
    type: "walletStatus",
    from: "popup"
  });
  const address = response?.ok ? (response.status.address as string | null) : null;
  if (!address) return;
  qrAddress.textContent = address;
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    address
  )}`;
  qrModal.classList.remove("hidden");
};

const closeQrUI = () => {
  qrModal.classList.add("hidden");
};

const confirmPending = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  payButton.disabled = true;
  payButton.textContent = "Processing";
  setStatus("Processing");
  const response = await browser.runtime.sendMessage({
    type: "confirmPendingPayment",
    from: "popup",
    tabId: tab.id
  });
  if (response?.ok) {
    payButton.textContent = "Unlocked";
    setStatus("Unlocked");
  } else {
    payButton.textContent = "Confirm";
    payButton.disabled = false;
    setStatus("Error");
  }
};

const payWithVeyrun = async () => {
  if (pendingPayment) {
    await confirmPending();
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  payButton.disabled = true;
  payButton.textContent = "Processing";
  setStatus("Processing");
  const response = await browser.runtime.sendMessage({
    type: "payWithVeyrun",
    from: "popup",
    tabId: tab.id
  });
  payButton.textContent = response?.ok ? "Unlocked" : "Pay with Veyrun";
  setStatus(response?.ok ? "Unlocked" : "Error");
  if (!response?.ok) {
    payButton.disabled = false;
  }
};

copyBtn?.addEventListener("click", async () => {
  const response = await browser.runtime.sendMessage({
    type: "walletStatus",
    from: "popup"
  });
  if (response?.ok && response.status?.address) {
    await navigator.clipboard.writeText(response.status.address as string);
    copyBtn.classList.add("copied");
    setTimeout(() => copyBtn.classList.remove("copied"), 1200);
  }
});

viewWalletBtn?.addEventListener("click", async () => {
  const response = await browser.runtime.sendMessage({
    type: "walletStatus",
    from: "popup"
  });
  const address = response?.ok ? response.status?.address : null;
  if (address) {
    browser.tabs.create({ url: `https://sepolia.basescan.org/address/${address}` });
  }
});

topupBtn?.addEventListener("click", openQr);
copyQr?.addEventListener("click", async () => {
  if (qrAddress.textContent) {
    await navigator.clipboard.writeText(qrAddress.textContent);
  }
});

changeAccountBtn?.addEventListener("click", openModal);
closeModal?.addEventListener("click", closeModalUI);
closeQr?.addEventListener("click", closeQrUI);

saveKey?.addEventListener("click", async () => {
  const newValue = newKey.value.trim();
  if (!newValue) return;
  const response = await browser.runtime.sendMessage({
    type: "walletImport",
    from: "popup",
    privateKey: newValue
  });
  if (response?.ok) {
    await loadWalletStatus();
    closeModalUI();
  }
});

exportHistoryBtn?.addEventListener("click", async () => {
  const response = await browser.runtime.sendMessage({
    type: "getReceipts",
    from: "popup"
  });
  if (response?.ok) {
    const blob = new Blob([JSON.stringify(response.receipts, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({
      url,
      filename: "veyrun-receipts.json"
    });
    URL.revokeObjectURL(url);
  }
});

resetWallet?.addEventListener("click", async () => {
  const confirmed = window.confirm("Reset agent wallet? This cannot be undone.");
  if (!confirmed) return;
  const response = await browser.runtime.sendMessage({
    type: "walletCreate",
    from: "popup"
  });
  if (response?.ok) {
    await loadWalletStatus();
    closeModalUI();
  }
});
payButton?.addEventListener("click", payWithVeyrun);

const init = async () => {
  await loadEvent();
  await loadWalletStatus();
  await loadPending();
  await loadHistory();
  const params = new URLSearchParams(window.location.search);
  if (params.get("topup") === "1") {
    await openQr();
    history.replaceState(null, "", "popup.html");
  }
};

init();

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "paymentStatus") {
    if (message.ok) {
      loadHistory();
      setStatus("Unlocked");
      payButton.textContent = "Unlocked";
      payButton.disabled = true;
      pendingPayment = null;
      return;
    }
    if (message.error) {
      setStatus("Error");
      pendingPayment = null;
      pendingRow.classList.add("hidden");
      payButton.textContent = "Pay with Veyrun";
      payButton.disabled = false;
    }
  }
});
