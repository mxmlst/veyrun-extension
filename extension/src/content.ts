const sendPing = async () => {
  try {
    await chrome.runtime.sendMessage({ type: "ping", from: "content" });
  } catch {
    // Ignore if background is not ready yet.
  }
};

sendPing();