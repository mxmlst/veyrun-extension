"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PaymentRequirement = {
  amount: string;
  asset: string;
  recipient: string;
  chain: string;
  nonce: string;
  description?: string;
};

type X402Accept = {
  price?: string;
  network?: string;
  payTo?: string;
  scheme?: string;
  amount?: string;
  asset?: string;
  extra?: { name?: string; decimals?: number };
  recipient?: string;
  chain?: string;
  nonce?: string;
};

const formatBaseUnits = (value: string, decimals: number) => {
  const raw = value.replace(/^0+/, "") || "0";
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals);
  const fracPart = padded.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

const normalizeRequirement = (accept: X402Accept): PaymentRequirement | null => {
  if (
    accept.amount &&
    accept.asset &&
    accept.recipient &&
    accept.chain &&
    accept.nonce
  ) {
    return {
      amount: accept.asset.startsWith("0x")
        ? formatBaseUnits(accept.amount, accept.extra?.decimals ?? 6)
        : accept.amount,
      asset: accept.asset.startsWith("0x") ? "USDC" : accept.asset,
      recipient: accept.recipient,
      chain: accept.chain,
      nonce: accept.nonce,
    };
  }

  if (accept.price && accept.payTo && accept.network) {
    const amount = accept.price.replace("$", "");
    const chain = accept.network.includes("84532")
      ? "base-sepolia"
      : accept.network;
    return {
      amount,
      asset: "USDC",
      recipient: accept.payTo,
      chain,
      nonce: `x402-${Date.now()}`,
    };
  }

  if (accept.amount && accept.asset && accept.payTo && accept.network) {
    const chain = accept.network.includes("84532")
      ? "base-sepolia"
      : accept.network;
    return {
      amount: accept.asset.startsWith("0x")
        ? formatBaseUnits(accept.amount, accept.extra?.decimals ?? 6)
        : accept.amount,
      asset: accept.asset.startsWith("0x") ? "USDC" : accept.asset,
      recipient: accept.payTo,
      chain,
      nonce: `x402-${Date.now()}`,
    };
  }

  return null;
};

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${pad}`);
};

const decodeRequirement = (header: string): PaymentRequirement | null => {
  try {
    const raw = header.trim().replace(/^\"|\"$/g, "");
    const decoded = raw.startsWith("{")
      ? (JSON.parse(raw) as {
          accepts: X402Accept[];
          resource?: { description?: string };
        })
      : (JSON.parse(decodeBase64Url(raw)) as {
          accepts: X402Accept[];
          resource?: { description?: string };
        });
    const accept = decoded.accepts?.[0];
    if (!accept) return null;
    const normalized = normalizeRequirement(accept);
    if (!normalized) return null;
    return {
      ...normalized,
      description: decoded.resource?.description,
    };
  } catch {
    return null;
  }
};

export default function ApiConsolePage() {
  const [endpoint, setEndpoint] = useState("http://localhost:3000/api/protected/article");
  const [status, setStatus] = useState("Idle");
  const [result, setResult] = useState<string>("");
  const [requirement, setRequirement] = useState<PaymentRequirement | null>(null);
  const [detected, setDetected] = useState(false);
  const [pending, setPending] = useState(false);
  const lastResponseRef = useRef<unknown>(null);

  const canPay = Boolean(requirement) && detected && !pending;

  const sendRequest = async () => {
    setStatus("Sending request...");
    setResult("");
    setPending(false);
    setRequirement(null);
    try {
      const response = await fetch(endpoint, { method: "GET" });
      if (!response.ok) {
        const header = response.headers.get("Payment-Required");
        if (header) {
          const parsed = decodeRequirement(header);
          setRequirement(parsed);
          setStatus(parsed ? "Payment required." : "Payment header parse failed.");
          return;
        }
        setStatus(`Error ${response.status}`);
        return;
      }
      const data = await response.json().catch(() => null);
      lastResponseRef.current = data;
      setStatus("Unlocked.");
      setResult(JSON.stringify(data, null, 2) ?? "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed.");
    }
  };

  const payWithVeyrun = async () => {
    if (!requirement) return;
    setPending(true);
    setStatus("Confirm payment in Veyrun.");
    window.postMessage(
      {
        source: "veyrun-page",
        type: "VEYRUN_PAY",
        payload: {
          requirement,
          url: endpoint,
          method: "GET",
        },
      },
      "*",
    );
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string; payload?: any };
      if (data?.source !== "veyrun-extension") return;

      if (data.type === "VEYRUN_READY") {
        setDetected(true);
      }

      if (data.type === "VEYRUN_PENDING") {
        setPending(true);
        setStatus("Confirm payment in Veyrun.");
      }

      if (data.type === "VEYRUN_PAID") {
        if (data.payload?.data) {
          lastResponseRef.current = data.payload.data;
          setResult(JSON.stringify(data.payload.data, null, 2) ?? "");
          setStatus("Unlocked.");
          setPending(false);
          return;
        }
        sendRequest().catch(() => setStatus("Unlock failed."));
      }

      if (data.type === "VEYRUN_ERROR") {
        setPending(false);
        setStatus(data.payload?.error ?? "Payment failed.");
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [endpoint, requirement]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Veyrun</p>
          <h1 className="text-2xl font-semibold">API Console</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Test any x402 endpoint without embedding a ReleaseButton.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://example.com/api/protected"
            />
            <button
              className="rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950"
              onClick={sendRequest}
            >
              Send
            </button>
            <button
              className="rounded-xl border border-red-900 bg-red-900/80 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={payWithVeyrun}
              disabled={!canPay}
            >
              Pay with Veyrun
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Status</p>
              <p className="mt-2 text-sm text-zinc-200">{status}</p>
              {requirement && (
                <div className="mt-3 text-xs text-zinc-400">
                  <p>Amount: {requirement.amount} {requirement.asset}</p>
                  <p>Recipient: {requirement.recipient}</p>
                  <p>Network: {requirement.chain}</p>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Response</p>
              <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <pre className="text-xs text-zinc-200 whitespace-pre-wrap break-words">
{result || "No response yet."}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
