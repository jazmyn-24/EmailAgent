import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

const features = [
  {
    num: "01",
    title: "Inbox Summary",
    description: "A clear daily digest of what matters most. Cut through the noise and stay in control.",
  },
  {
    num: "02",
    title: "Smart Replies",
    description: "AI-crafted responses that sound like you. Review and send in one click.",
  },
  {
    num: "03",
    title: "Auto Calendar Booking",
    description: "Turn scheduling threads into calendar invites automatically. Zero back-and-forth.",
  },
  {
    num: "04",
    title: "Voice Queries",
    description: "Ask your inbox anything by voice. Instant answers, no searching required.",
  },
];

const bullets = [
  "Gmail & Outlook connected",
  "Auto-replies in your voice",
  "Calendar booking handled",
];

export default async function Home() {
  const { userId } = await auth();
  return (
    <div
      className="min-h-screen font-sans antialiased text-zinc-900"
      style={{ background: "linear-gradient(135deg, #f5f3ff 0%, #eff6ff 50%, #f0fdf4 100%)" }}
    >
      {/* Navbar */}
      <nav
        className="sticky top-0 z-50"
        style={{
          background: "rgba(255,255,255,0.70)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(139,92,246,0.12)",
        }}
      >
        <div className="mx-auto max-w-7xl px-10 py-4 flex items-center gap-3">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#7c3aed,#6366f1)" }}
          />
          <span className="text-xl font-bold tracking-tight text-zinc-900">MailMind</span>
          <span className="text-sm text-zinc-400">AI email intelligence</span>
        </div>
        {/* Purple gradient accent line */}
        <div
          className="h-[3px] w-full"
          style={{ background: "linear-gradient(90deg, #7c3aed 0%, #6366f1 40%, #06b6d4 100%)" }}
        />
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-10 py-24 sm:py-32">
        <div className="flex flex-col gap-16 lg:flex-row lg:items-start lg:gap-20">

          {/* Left */}
          <div className="flex-1 pt-2">
            {/* Pill badge */}
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-7 text-sm font-semibold"
              style={{ background: "rgba(124,58,237,0.10)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.20)" }}>
              ✨ AI-Powered Email Agent
            </div>

            <h1 className="text-5xl font-extrabold tracking-tight leading-[1.1] text-zinc-900 sm:text-6xl">
              Your inbox,<br />on autopilot.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-500 max-w-md">
              Save 2+ hours every day on email. MailMind handles Gmail and Outlook
              so you can focus on what actually matters.
            </p>

            {/* Bullet points */}
            <ul className="mt-7 space-y-3">
              {bullets.map((b) => (
                <li key={b} className="flex items-center gap-3 text-zinc-700 text-[0.95rem] font-medium">
                  <span className="font-bold" style={{ color: "#7c3aed" }}>✓</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: sign-in card or dashboard CTA */}
          <div className="w-full flex-shrink-0 lg:w-[400px]">
            {userId ? (
              <div className="rounded-2xl border bg-white p-10 text-center shadow-sm"
                style={{ borderColor: "#e9d5ff", boxShadow: "0 4px 32px rgba(124,58,237,0.08)" }}>
                <p className="text-sm font-semibold text-violet-600 mb-2">You&apos;re signed in</p>
                <h2 className="text-xl font-bold text-zinc-900 mb-4">Go to your dashboard</h2>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white transition-colors"
                  style={{ background: "#7c3aed" }}
                >
                  Open Dashboard →
                </Link>
              </div>
            ) : (
              <SignIn
                routing="hash"
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    card: "bg-white rounded-2xl border",
                    header: "px-1 pt-1",
                    headerTitle: "text-lg font-bold text-zinc-900",
                    headerSubtitle: "text-sm text-zinc-500",
                    footer: "bg-white rounded-b-2xl",
                    footerPages: "bg-white",
                    footerPagesLink: "text-violet-600 hover:text-violet-700",
                    formButtonPrimary:
                      "bg-violet-600 hover:bg-violet-700 text-sm font-semibold rounded-xl transition-colors",
                    socialButtonsBlockButton:
                      "border border-zinc-200 bg-white hover:bg-zinc-50 text-sm font-medium text-zinc-800 rounded-xl transition-colors",
                    dividerLine: "bg-zinc-200",
                    dividerText: "text-zinc-400 text-xs",
                    formFieldLabel: "text-sm font-medium text-zinc-700",
                    formFieldInput:
                      "bg-zinc-50 border-zinc-200 text-zinc-900 rounded-xl text-sm",
                    badge: "opacity-50",
                  },
                  variables: {
                    colorPrimary: "#7c3aed",
                    colorBackground: "#ffffff",
                    colorInputBackground: "#f9fafb",
                    colorInputText: "#111827",
                    colorText: "#111827",
                    colorTextSecondary: "#6b7280",
                    borderRadius: "0.75rem",
                  },
                  layout: {
                    socialButtonsPlacement: "top",
                  },
                }}
              />
            )}
          </div>

        </div>
      </section>

      {/* Features */}
      <section style={{ background: "#faf5ff" }} className="border-t border-purple-100">
        <div className="mx-auto max-w-7xl px-10 py-20 sm:py-24">
          <h2 className="text-2xl font-bold text-zinc-900 mb-10">
            Everything your inbox needs
          </h2>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <li
                key={f.num}
                className="rounded-2xl bg-white p-7 shadow-sm"
                style={{
                  border: "1px solid #ede9fe",
                  borderLeft: "4px solid #7c3aed",
                }}
              >
                <span className="text-sm font-extrabold" style={{ color: "#7c3aed" }}>{f.num}</span>
                <h3 className="mt-3 text-base font-bold text-zinc-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{f.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-zinc-100 py-8">
        <p className="text-center text-sm text-zinc-400">
          © 2025 MailMind · made with <span style={{ color: "#7c3aed" }}>♥</span>
        </p>
      </footer>

    </div>
  );
}
