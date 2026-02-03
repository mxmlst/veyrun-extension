const input = document.getElementById("input");
const output = document.getElementById("output");
const parseBtn = document.getElementById("parse");

parseBtn?.addEventListener("click", async () => {
  output.textContent = "Parsing...";
  const value = input.value.trim();
  const response = await chrome.runtime.sendMessage({
    type: "parsePaymentRequired",
    from: "debug",
    value
  });

  if (!response?.ok) {
    output.textContent = "Failed to parse.";
    return;
  }

  output.textContent = JSON.stringify(response.parsed, null, 2) ?? "null";
});