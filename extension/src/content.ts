const post = (type: string, payload?: unknown) => {
  window.postMessage({ source: "veyrun-extension", type, payload }, "*");
};

const handlePay = async (payload: {
  requirement: { amount: string; asset: string; recipient: string; chain: string; nonce: string };
  url: string;
  method?: string;
}) => {
  const response = await chrome.runtime.sendMessage({
    type: "payWithVeyrunDirect",
    from: "content",
    requirement: payload.requirement,
    url: payload.url,
    method: payload.method
  });

  if (response?.ok && response.pending) {
    post("VEYRUN_PENDING");
    return;
  }

  if (response?.ok) {
    post("VEYRUN_PAID", { receipt: response.receipt, data: response.data });
  } else {
    post("VEYRUN_ERROR", { error: response?.error ?? "Payment failed" });
  }
};

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "paymentResult") {
    if (message.ok) {
      post("VEYRUN_PAID", { receipt: message.receipt, data: message.data });
    } else {
      post("VEYRUN_ERROR", { error: message.error ?? "Payment failed" });
    }
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; payload?: any };
  if (data?.source !== "veyrun-page") return;
  if (data.type === "VEYRUN_PAY") {
    handlePay(data.payload);
  }
});

post("VEYRUN_READY");
