import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchEmails, fetchSentCount } from "@/lib/gmail";
import { scorePriorities } from "@/lib/scoring";
import OpenAI from "openai";
import type { ScoredEmail } from "@/lib/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateDigest(emails: ScoredEmail[]): Promise<string> {
  if (emails.length === 0) return "No emails to summarize.";
  const highPriority = emails.filter((e) => e.priority === 1);
  const list = emails
    .slice(0, 15)
    .map((e, i) => `[${i + 1}] [P${e.priority}] ${e.from} | ${e.subject} | ${e.snippet.slice(0, 80)}`)
    .join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `You are an AI email assistant. Write a 2-3 sentence daily digest for the user's inbox. Be direct and helpful. Mention any high-priority items first (there are ${highPriority.length} high-priority emails). Keep it concise and conversational.\n\nEmails:\n${list}`,
        },
      ],
      max_tokens: 150,
      temperature: 0.4,
    });
    return res.choices[0]?.message?.content?.trim() ?? "Your inbox is ready to review.";
  } catch {
    return "Your inbox is ready to review.";
  }
}

async function generateNewsletterDigest(newsletters: ScoredEmail[]): Promise<string> {
  if (newsletters.length === 0) return "";
  const list = newsletters
    .slice(0, 8)
    .map((e) => `- ${e.from.split("<")[0].trim()}: ${e.subject}`)
    .join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Summarize these newsletters/promotions in 2-3 bullet points. Be brief and highlight anything potentially interesting. No preamble.\n\n${list}`,
        },
      ],
      max_tokens: 120,
      temperature: 0.3,
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  }
}

function getGreeting(firstName: string): string {
  const hour = new Date().getHours();
  const time = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${time}, ${firstName}`;
}

export default async function DashboardPage() {
  const user = await currentUser();
  const firstName = user?.firstName ?? user?.username ?? "there";

  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("clerk_user_id", user?.id ?? "")
    .single();

  if (!tokenRow) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-50 h-full">
        <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center max-w-sm shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-2">Connect your Gmail</h2>
          <p className="text-sm text-zinc-500 mb-6">Connect Gmail to see your dashboard.</p>
          <a
            href="/api/auth/gmail"
            className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
          >
            Connect Gmail
          </a>
        </div>
      </div>
    );
  }

  let emails: ScoredEmail[] = [];
  let digest = "";
  let newsletterDigest = "";
  let sentCount = 0;

  try {
    const { data: feedbackRows } = await supabaseAdmin
      .from("priority_feedback")
      .select("sender_domain")
      .eq("clerk_user_id", user?.id ?? "")
      .eq("correct_priority", 3)
      .not("sender_domain", "is", null);

    const promoDomainsLearned = [
      ...new Set(
        (feedbackRows ?? [])
          .map((r: { sender_domain: string }) => r.sender_domain)
          .filter(Boolean)
      ),
    ] as string[];

    const [raw, fetchedSentCount] = await Promise.all([
      fetchEmails(tokenRow.access_token, tokenRow.refresh_token),
      fetchSentCount(tokenRow.access_token, tokenRow.refresh_token),
    ]);

    sentCount = fetchedSentCount;
    const scores = await scorePriorities(raw, promoDomainsLearned);

    emails = raw.map((e, i) => ({
      ...e,
      priority: scores[i].score,
      reason: scores[i].reason,
    }));

    const newsletters = emails.filter((e) => e.priority === 3);
    [digest, newsletterDigest] = await Promise.all([
      generateDigest(emails),
      generateNewsletterDigest(newsletters),
    ]);
  } catch {
    // fall through with empty state
  }

  const highPriority = emails.filter((e) => e.priority === 1);
  const newsletters = emails.filter((e) => e.priority === 3);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const statCards = [
    {
      label: "Emails Today",
      value: emails.length,
      sub: "in your inbox",
      color: "bg-violet-50 border-violet-100",
      textColor: "text-violet-700",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      ),
    },
    {
      label: "Need Attention",
      value: highPriority.length,
      sub: "high priority",
      color: "bg-red-50 border-red-100",
      textColor: "text-red-600",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
    },
    {
      label: "Replied Today",
      value: sentCount,
      sub: "emails sent",
      color: "bg-emerald-50 border-emerald-100",
      textColor: "text-emerald-700",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 17 4 12 9 7" />
          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
      ),
    },
    {
      label: "Newsletters",
      value: newsletters.length,
      sub: "low priority",
      color: "bg-amber-50 border-amber-100",
      textColor: "text-amber-700",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
          <path d="M18 14h-8" />
          <path d="M15 18h-5" />
          <path d="M10 6h8v4h-8V6Z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-zinc-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs text-zinc-400 mb-1">{today}</p>
          <h1 className="text-2xl font-bold text-zinc-900">{getGreeting(firstName)} 👋</h1>
          <p className="text-sm text-zinc-500 mt-1">Here's what's happening in your inbox.</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-2xl border p-4 ${card.color}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-zinc-500">{card.label}</span>
                {card.icon}
              </div>
              <div className={`text-3xl font-bold ${card.textColor}`}>{card.value}</div>
              <div className="text-xs text-zinc-400 mt-1">{card.sub}</div>
            </div>
          ))}
        </div>

        {/* AI Digest card */}
        {digest && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">AI Daily Digest</span>
            </div>
            <p className="text-sm text-zinc-700 leading-relaxed">{digest}</p>
            <div className="mt-3">
              <Link
                href="/dashboard/inbox"
                className="text-xs font-medium text-violet-600 hover:text-violet-800 transition-colors"
              >
                Open Inbox →
              </Link>
            </div>
          </div>
        )}

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-5">
          {/* Priority Emails */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">Priority Emails</h2>
              <Link
                href="/dashboard/inbox"
                className="text-xs text-violet-600 hover:text-violet-800 font-medium"
              >
                View all →
              </Link>
            </div>
            {highPriority.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">No high-priority emails</p>
            ) : (
              <div className="space-y-3">
                {highPriority.slice(0, 5).map((email) => (
                  <Link
                    key={email.id}
                    href="/dashboard/inbox"
                    className="block group"
                  >
                    <div className="flex items-start gap-3 p-3 rounded-xl hover:bg-zinc-50 transition-colors">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-900 truncate group-hover:text-violet-700 transition-colors">
                          {email.from.split("<")[0].trim() || email.from}
                        </p>
                        <p className="text-xs text-zinc-600 truncate">{email.subject}</p>
                        <p className="text-xs text-zinc-400 truncate mt-0.5">{email.snippet.slice(0, 60)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Newsletter Digest */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">Newsletter Digest</h2>
              <span className="text-xs text-zinc-400">{newsletters.length} newsletters</span>
            </div>
            {newsletterDigest ? (
              <div className="text-sm text-zinc-600 leading-relaxed whitespace-pre-line">
                {newsletterDigest}
              </div>
            ) : newsletters.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-6">No newsletters today</p>
            ) : (
              <div className="space-y-2">
                {newsletters.slice(0, 5).map((email) => (
                  <div key={email.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">
                        {email.from.split("<")[0].trim()}
                      </p>
                      <p className="text-xs text-zinc-400 truncate">{email.subject}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
