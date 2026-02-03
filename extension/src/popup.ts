const statusEl = document.getElementById("status");

const load = async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "getStatus",
      from: "popup"
    });

    if (response?.ok) {
      const lastPingAt = response.status.lastPingAt
        ? new Date(response.status.lastPingAt).toLocaleTimeString()
        : "never";
      statusEl!.textContent = `Ready. Last content ping: ${lastPingAt}.`;
      return;
    }
  } catch {
    // ignore
  }

  statusEl!.textContent = "Veyrun ready.";
};

load();