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
};

const statusPill = document.getElementById("status-pill") as HTMLElement;
const eventDomain = document.getElementById("event-domain") as HTMLElement;
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
const refreshBtn = document.getElementById("refresh-balance") as HTMLButtonElement;
const topupBtn = document.getElementById("topup") as HTMLButtonElement;
const createAgentBtn = document.getElementById("create-agent") as HTMLButtonElement;
const changeAccountBtn = document.getElementById("change-account") as HTMLButtonElement;

const modal = document.getElementById("modal") as HTMLElement;
const closeModal = document.getElementById("close-modal") as HTMLButtonElement;
const currentKey = document.getElementById("current-key") as HTMLInputElement;
const newKey = document.getElementById("new-key") as HTMLInputElement;
const saveKey = document.getElementById("save-key") as HTMLButtonElement;

const qrModal = document.getElementById("qr-modal") as HTMLElement;
const closeQr = document.getElementById("close-qr") as HTMLButtonElement;
const qrImage = document.getElementById("qr-image") as HTMLImageElement;
const qrAddress = document.getElementById("qr-address") as HTMLElement;

let pendingPayment: PendingPayment | null = null;

const truncate = (value: string, keep = 6) => {
  if (value.length <= keep * 2) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const formatAsset = (asset: string) => {
  if (asset.startsWith("0x")) return "USDC";
  return asset;
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
  walletBalance.textContent = status?.address
    ? `${balance ?? "0.00"} USDC`
    : "-";
  walletChain.textContent = chain ? `${chain.name} (${chain.id})` : "-";
};

const loadEvent = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("Idle");
    payButton.disabled = true;
    return null;
  }

  const response = await chrome.runtime.sendMessage({
    type: "getLastEvent",
    from: "popup",
    tabId: tab.id
  });

  if (response?.ok && response.event) {
    const event = response.event as PaymentEvent;
    const host = new URL(event.url).hostname;
    const accepts = event.paymentRequired?.accepts?.[0];
    const amount = accepts
      ? `${accepts.amount} ${formatAsset(accepts.asset)}`
      : "unknown";
    const recipient = accepts?.recipient ?? "unknown";
    eventDomain.textContent = host;
    eventAmount.textContent = amount;
    eventRecipient.textContent = truncate(recipient, 8);
    eventTime.textContent = new Date(event.timestamp).toLocaleTimeString();
    setStatus("402");
    return event;
  }

  eventDomain.textContent = "-";
  eventAmount.textContent = "-";
  eventRecipient.textContent = "-";
  eventTime.textContent = "-";
  payButton.disabled = true;
  setStatus("Idle");
  return null;
};

const fetchBalance = async (address: string | null) => {
  if (!address) return null;
  const response = await chrome.runtime.sendMessage({
    type: "walletUsdcBalance",
    from: "popup",
    address
  });
  return response?.ok ? (response.balance as string) : null;
};

const loadWalletStatus = async () => {
  const [statusResponse, chainResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: "walletStatus", from: "popup" }),
    chrome.runtime.sendMessage({ type: "walletChain", from: "popup" })
  ]);

  const status = statusResponse?.ok ? (statusResponse.status as WalletStatus) : null;
  const chain = chainResponse?.ok ? (chainResponse.chain as ChainInfo) : null;
  const balance = status?.address ? await fetchBalance(status.address) : null;

  setWalletUI(status, chain, balance);
};

const loadPending = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const response = await chrome.runtime.sendMessage({
    type: "getPendingPayment",
    from: "popup",
    tabId: tab.id
  });
  pendingPayment = response?.ok ? (response.pending as PendingPayment | null) : null;
  if (pendingPayment) {
    pendingRow.classList.remove("hidden");
    pendingValue.textContent = `${pendingPayment.amount} ${pendingPayment.asset}`;
    payButton.disabled = false;
    payButton.textContent = "Confirm payment";
  } else {
    pendingRow.classList.add("hidden");
    payButton.textContent = "Pay with Veyrun";
  }
};

const openModal = async () => {
  const response = await chrome.runtime.sendMessage({
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
  const response = await chrome.runtime.sendMessage({
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  payButton.disabled = true;
  payButton.textContent = "Paying...";
  const response = await chrome.runtime.sendMessage({
    type: "confirmPendingPayment",
    from: "popup",
    tabId: tab.id
  });
  if (response?.ok) {
    payButton.textContent = "Paid";
  } else {
    payButton.textContent = "Confirm payment";
    payButton.disabled = false;
  }
};

const payWithVeyrun = async () => {
  if (pendingPayment) {
    await confirmPending();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  payButton.disabled = true;
  payButton.textContent = "Paying...";
  const response = await chrome.runtime.sendMessage({
    type: "payWithVeyrun",
    from: "popup",
    tabId: tab.id
  });
  payButton.textContent = response?.ok ? "Paid" : "Pay with Veyrun";
  if (!response?.ok) {
    payButton.disabled = false;
  }
};

copyBtn?.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "walletStatus",
    from: "popup"
  });
  if (response?.ok && response.status?.address) {
    await navigator.clipboard.writeText(response.status.address as string);
  }
});

refreshBtn?.addEventListener("click", async () => {
  await loadWalletStatus();
});

topupBtn?.addEventListener("click", openQr);

createAgentBtn?.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "walletCreate",
    from: "popup"
  });
  if (response?.ok) {
    await loadWalletStatus();
  }
});

changeAccountBtn?.addEventListener("click", openModal);
closeModal?.addEventListener("click", closeModalUI);
closeQr?.addEventListener("click", closeQrUI);

saveKey?.addEventListener("click", async () => {
  const newValue = newKey.value.trim();
  if (!newValue) return;
  const response = await chrome.runtime.sendMessage({
    type: "walletImport",
    from: "popup",
    privateKey: newValue
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
};

init();
