import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-16">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Veyrun
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Ozentti Sandbox
          </h1>
          <p className="max-w-2xl text-lg text-zinc-600">
            Deterministic 402 endpoints for testing the Veyrun extension unlock
            flow.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <Link
            href="/article"
            className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Paywalled Article</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Fetches protected content and returns 402 until paid.
            </p>
          </Link>
          <Link
            href="/download"
            className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Paywalled Download</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Returns a signed token once a mock payment succeeds.
            </p>
          </Link>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h3 className="text-lg font-semibold">Mock Payment Signature</h3>
          <p className="mt-2 text-sm text-zinc-600">
            Use header <span className="font-mono">Payment-Signature</span> with
            value <span className="font-mono">mock-signature</span> to unlock.
          </p>
        </section>
      </main>
    </div>
  );
}