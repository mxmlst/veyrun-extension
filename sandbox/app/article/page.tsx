"use client";

import { useState } from "react";
import Link from "next/link";

const ARTICLE_ENDPOINT = "/api/protected/article";

export default function ArticlePage() {
  const [status, setStatus] = useState("Idle");
  const [content, setContent] = useState<string | null>(null);

  const fetchArticle = async (withSignature: boolean) => {
    setStatus("Loading...");
    setContent(null);
    try {
      const response = await fetch(ARTICLE_ENDPOINT, {
        headers: withSignature
          ? {
              "Payment-Signature": "mock-signature"
            }
          : undefined
      });

      if (!response.ok) {
        setStatus(`Locked (status ${response.status}).`);
        return;
      }

      const data = await response.json();
      setContent(data.content ?? "Unlocked");
      setStatus("Unlocked");
    } catch {
      setStatus("Failed to load.");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <Link href="/" className="text-sm text-zinc-500">
          ? Back
        </Link>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold">Paywalled Article</h1>
          <p className="mt-2 text-sm text-zinc-600">
            {status}. Use the mock payment signature to unlock.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white"
              onClick={() => fetchArticle(false)}
            >
              Fetch (locked)
            </button>
            <button
              className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-semibold"
              onClick={() => fetchArticle(true)}
            >
              Fetch with mock signature
            </button>
          </div>
          {content ? (
            <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
              {content}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}