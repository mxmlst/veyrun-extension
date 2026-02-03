"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

const ARTICLE_ENDPOINT = "/api/protected/article";

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

const normalizeRequirement = (
  accept: X402Accept,
): PaymentRequirement | null => {
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

export default function ArticlePage() {
  const [status, setStatus] = useState("Loading...");
  const [content, setContent] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [detected, setDetected] = useState(false);
  const [requirement, setRequirement] = useState<PaymentRequirement | null>(
    null,
  );
  const [buttonLabel, setButtonLabel] = useState("Pay");
  const [buttonDisabled, setButtonDisabled] = useState(true);
  const initializedRef = useRef(false);

  const lockedContent = useMemo(
    () =>
      "This is the premium article text. It stays blurred until a verified Veyrun payment arrives.",
    [],
  );

  const fetchArticle = async () => {
    const response = await fetch(ARTICLE_ENDPOINT);
    if (!response.ok) {
      const header = response.headers.get("Payment-Required");
      if (header) {
        const parsed = decodeRequirement(header);
        console.debug("[x402] Payment-Required header", header);
        console.debug("[x402] Parsed requirement", parsed);
        setRequirement(parsed);
        setButtonDisabled(!parsed);
        setButtonLabel(parsed ? (detected ? "Pay with Veyrun" : "Pay") : "Pay");
        if (!parsed) {
          setStatus("Payment header parse failed.");
        }
      }
      setLocked(true);
      setContent(null);
      const lockedStatus = `Locked (status ${response.status}).`;
      if (status !== lockedStatus) {
        setStatus(lockedStatus);
      }
      return;
    }

    const data = await response.json();
    setContent(data.content ?? "Unlocked");
    setLocked(false);
    setStatus("Unlocked");
    setButtonLabel("Unlocked");
    setButtonDisabled(true);
    console.debug("[x402] Unlocked: article");
  };

  const payWithVeyrun = async () => {
    if (!requirement) return;
    setStatus("Waiting for Veyrun...");
    console.debug("[x402] Sending VEYRUN_PAY", requirement);
    setButtonLabel("Waiting...");
    setButtonDisabled(true);
    const targetUrl = new URL(
      ARTICLE_ENDPOINT,
      window.location.origin,
    ).toString();
    window.postMessage(
      {
        source: "veyrun-page",
        type: "VEYRUN_PAY",
        payload: {
          requirement,
          url: targetUrl,
          method: "GET",
        },
      },
      "*",
    );
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: any;
      };
      if (data?.source !== "veyrun-extension") return;

      if (data.type === "VEYRUN_READY") {
        setDetected(true);
        setButtonLabel(requirement ? "Pay with Veyrun" : "Pay");
        setButtonDisabled(!requirement);
      }

      if (data.type === "VEYRUN_PENDING") {
        setStatus("Confirm payment in Veyrun extension...");
        setButtonLabel("Confirm in Veyrun");
        setButtonDisabled(true);
      }

      if (data.type === "VEYRUN_PAID") {
        if (data.payload?.data?.content) {
          setContent(data.payload.data.content);
          setLocked(false);
          setStatus("Unlocked");
          setButtonLabel("Paid");
          setButtonDisabled(true);
          console.debug("[x402] Unlocked via extension response");
          return;
        }
        fetchArticle().catch(() => setStatus("Unlock failed."));
      }

      if (data.type === "VEYRUN_ERROR") {
        setStatus(data.payload?.error ?? "Payment failed.");
        setButtonLabel(detected ? "Pay with Veyrun" : "Pay");
        setButtonDisabled(!requirement);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [requirement]);

  useEffect(() => {
    if (locked && requirement) {
      setButtonLabel(detected ? "Pay with Veyrun" : "Pay");
      setButtonDisabled(false);
    }
  }, [detected, requirement, locked]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    fetchArticle();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <Link href="/" className="text-sm text-zinc-500">
          ? Back
        </Link>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold">Paywalled Article</h1>
          <p className="mt-2 text-sm text-zinc-600">{status}</p>
          <div
            className={`mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 ${
              locked ? "blur-sm" : ""
            }`}
          >
            {content ?? lockedContent}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white"
              onClick={payWithVeyrun}
              disabled={buttonDisabled}
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
