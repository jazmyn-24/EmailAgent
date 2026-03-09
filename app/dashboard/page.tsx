import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { google } from "googleapis";
import OpenAI from "openai";
import DashboardClient from "./DashboardClient";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ScoredEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  priority: 1 | 2 | 3;
  reason: string;
}

async function fetchEmails(
  accessToken: string,
  refreshToken: string | null
): Promise<Omit<ScoredEmail, "priority" | "reason">[]> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const listRes = await gmail.users.messages.list({ userId: "me", maxResults: 20 });
  const messages = listRes.data.messages ?? [];

  return Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date", "CC", "List-Unsubscribe"],
      });
      const headers = detail.data.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      return {
        id: msg.id!,
        from: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: detail.data.snippet ?? "",
        cc: get("CC"),
        listUnsubscribe: get("List-Unsubscribe"),
      };
    })
  );
}

async function scorePriorities(
  emails: Omit<ScoredEmail, "priority" | "reason">[],
  promoDomainsLearned: string[]
): Promise<{ score: 1 | 2 | 3; reason: string }[]> {
  if (emails.length === 0) return [];

  const promoHint = promoDomainsLearned.length
    ? `\nUser-marked promo domains (always score 3): ${promoDomainsLearned.join(", ")}`
    : "";

  const list = emails
    .map((e, i) => `${i + 1}. From: ${e.from} | Subject: ${e.subject} | Snippet: ${(e.snippet ?? "").slice(0, 100)}`)
    .join("\n");

  const prompt = `You are an email priority classifier. Score each email 1–3 using THESE EXACT RULES:

SCORE 3 (LOW) — if ANY of these apply:
- Sender is a known brand, retailer, or business (Temu, SHEIN, BestBuy, Zara, Papa Johns, Amazon, Netflix, Spotify, LinkedIn, Twitter/X, GitHub notifications, Notion, Slack digests, any store/shop/mall)
- Sender address contains: noreply, no-reply, notifications@, alerts@, newsletter@, marketing@, info@, support@, hello@, team@, news@
- Subject has: sale, deal, offer, % off, discount, promo, coupon, free shipping, limited time, unsubscribe, newsletter, digest, update, receipt, order confirmation, welcome to, verify your email
- Sender domain looks like: mail.*, em.*, email.*, mg.*, send.*, replies.*, bounce.*
- Automated/transactional: receipts, shipping updates, password resets, verification codes${promoHint}

SCORE 1 (HIGH) — ALL of these must be true:
- Sender appears to be a real individual person (has a name, personal email domain like gmail/yahoo/outlook/icloud, or work email that isn't a brand)
- Subject or snippet contains a direct question, request, deadline, or genuine urgency (urgent, ASAP, deadline, by [date], can you, please, need you to, following up)
- NOT a CC email, NOT automated

SCORE 2 (MEDIUM) — everything else:
- Notifications worth reading but no action needed
- CC emails
- Business emails that aren't urgent

Return ONLY a JSON array, one object per email, in order:
[{"score":1,"reason":"Brief 1-sentence explanation"},...]

Emails:
${list}`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const text = res.choices[0]?.message?.content ?? "{}";
    // model returns {"results":[...]} or just [...]
    let parsed: { score: number; reason: string }[];
    try {
      const obj = JSON.parse(text);
      parsed = Array.isArray(obj) ? obj : (obj.results ?? obj.emails ?? Object.values(obj)[0]);
    } catch {
      return emails.map(() => ({ score: 2 as const, reason: "Could not score" }));
    }

    return emails.map((_, i) => {
      const item = parsed[i];
      const s = item?.score;
      return {
        score: (s === 1 || s === 2 || s === 3 ? s : 2) as 1 | 2 | 3,
        reason: item?.reason ?? "No reason provided",
      };
    });
  } catch {
    return emails.map(() => ({ score: 2 as const, reason: "Scoring unavailable" }));
  }
}

export default async function DashboardPage() {
  const user = await currentUser();
  const displayName =
    user?.firstName ?? user?.username ?? user?.emailAddresses[0]?.emailAddress ?? "there";

  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("clerk_user_id", user?.id ?? "")
    .single();

  let emails: ScoredEmail[] = [];
  let emailContext = "";

  if (tokenRow) {
    try {
      // Fetch learned promo domains from feedback
      const { data: feedbackRows } = await supabaseAdmin
        .from("priority_feedback")
        .select("sender_domain")
        .eq("clerk_user_id", user?.id ?? "")
        .eq("correct_priority", 3)
        .not("sender_domain", "is", null);

      const promoDomainsLearned = [
        ...new Set((feedbackRows ?? []).map((r: { sender_domain: string }) => r.sender_domain).filter(Boolean)),
      ] as string[];

      const raw = await fetchEmails(tokenRow.access_token, tokenRow.refresh_token);
      const scores = await scorePriorities(raw, promoDomainsLearned);

      emails = raw.map((e, i) => ({
        ...e,
        priority: scores[i].score,
        reason: scores[i].reason,
      }));

      const priorityLabel = (p: number) => p === 1 ? "HIGH" : p === 2 ? "MED" : "LOW";
      emailContext = emails
        .map(
          (e, i) =>
            `[${i + 1}] [${priorityLabel(e.priority)}] ${e.from} | ${e.subject} | ${e.date}${e.snippet ? ` | ${e.snippet.slice(0, 50)}` : ""}`
        )
        .join("\n");
    } catch {
      // token expired or invalid — fall through to show connect button
    }
  }

  return (
    <div className="h-screen flex flex-col bg-white font-sans antialiased text-zinc-900 overflow-hidden">
      <header className="flex-shrink-0 border-b border-zinc-200 bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-600" />
            <Link href="/" className="text-base font-bold tracking-tight text-zinc-900">
              MailMind
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {tokenRow && (
              <a
                href="/api/auth/gmail/disconnect"
                className="text-xs font-medium text-zinc-400 hover:text-red-500 transition-colors border border-zinc-200 hover:border-red-200 rounded-lg px-3 py-1.5"
              >
                Disconnect Gmail
              </a>
            )}
            <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
          </div>
        </div>
      </header>

      {!tokenRow || emails.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-zinc-50">
          <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center max-w-sm shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 mb-2">Connect your Gmail</h2>
            <p className="text-sm text-zinc-500 mb-6">Connect Gmail to chat with your inbox using AI.</p>
            <a
              href="/api/auth/gmail"
              className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
            >
              Connect Gmail
            </a>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DashboardClient emails={emails} emailContext={emailContext} displayName={displayName} />
        </div>
      )}
    </div>
  );
}
