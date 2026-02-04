"use client";

import { ReleaseButton } from "@ozentti/veyrun";
import Link from "next/link";

export default function PlaygroundPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <Link href="/" className="text-sm text-zinc-500">
          ? Back
        </Link>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold">Veyrun Playground</h1>
          <p className="mt-2 text-sm text-zinc-600">
            This page uses the published @ozentti/veyrun ReleaseButton.
          </p>

          <div className="mt-6">
            <ReleaseButton
              endpoint="/api/protected/article"
              labels={{ detected: "Pay with Veyrun", idle: "Pay" }}
              renderUnlocked={(data) => {
                const payload = data as { content?: string } | null;
                return (
                  <article className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                    <h2 className="text-base font-semibold">Unlocked</h2>
                    <p className="mt-2">
                      {payload?.content ??
                        "Unlocked content loaded from the x402 endpoint."}
                    </p>
                  </article>
                );
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
