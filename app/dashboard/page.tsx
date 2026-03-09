import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { google } from "googleapis";
import OpenAI from "openai";
import DashboardClient from "./DashboardClient";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Email {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  priority: 1 | 2 | 3;
}

async function fetchEmails(accessToken: string, refreshToken: string | null): Promise<Omit<Email, "priority">[]> {
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
        metadataHeaders: ["From", "Subject", "Date"],
      });
      const headers = detail.data.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
      return { id: msg.id!, from: get("From"), subject: get("Subject"), date: get("Date"), snippet: detail.data.snippet ?? "" };
    })
  );
}

async function scorePriorities(emails: Omit<Email, "priority">[]): Promise<(1 | 2 | 3)[]> {
  if (emails.length === 0) return [];
  const list = emails
    .map((e, i) => `${i + 1}. From: ${e.from} | Subject: ${e.subject} | Snippet: ${e.snippet.slice(0, 80)}`)
    .join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Score each email 1–3:\n1=High (needs reply, urgent, from a real person)\n2=Medium (newsletter, notification worth reading)\n3=Low (promo, marketing, automated)\n\nReturn ONLY a JSON array of integers in the same order, e.g. [1,2,3,1,2]\n\nEmails:\n${list}`,
        },
      ],
      max_tokens: 120,
      temperature: 0,
    });

    const text = res.choices[0]?.message?.content ?? "[]";
    const match = text.match(/\[[\d,\s]+\]/);
    if (!match) return emails.map(() => 2);

    const scores = JSON.parse(match[0]) as number[];
    return emails.map((_, i) => {
      const s = scores[i];
      return (s === 1 || s === 2 || s === 3 ? s : 2) as 1 | 2 | 3;
    });
  } catch {
    return emails.map(() => 2 as const);
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

  let emails: Email[] = [];
  let emailContext = "";

  if (tokenRow) {
    try {
      const raw = await fetchEmails(tokenRow.access_token, tokenRow.refresh_token);
      const priorities = await scorePriorities(raw);
      emails = raw.map((e, i) => ({ ...e, priority: priorities[i] }));
      emailContext = emails
        .map(
          (e, i) =>
            `[${i + 1}] P${e.priority} ${e.from} | ${e.subject} | ${e.date}${e.snippet ? ` | ${e.snippet.slice(0, 50)}` : ""}`
        )
        .join("\n");
    } catch {
      // token expired or invalid — fall through to show connect button
    }
  }

  return (
    <div className="h-screen flex flex-col bg-white font-sans antialiased text-zinc-900 overflow-hidden">
      {/* Navbar */}
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

      {/* Body */}
      {!tokenRow || emails.length === 0 ? (
        /* Not connected */
        <div className="flex-1 flex items-center justify-center bg-zinc-50">
          <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center max-w-sm shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 mb-2">Connect your Gmail</h2>
            <p className="text-sm text-zinc-500 mb-6">
              Connect Gmail to chat with your inbox using AI.
            </p>
            <a
              href="/api/auth/gmail"
              className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
            >
              Connect Gmail
            </a>
          </div>
        </div>
      ) : (
        /* Chat interface */
        <div className="flex-1 overflow-hidden">
          <DashboardClient emails={emails} emailContext={emailContext} displayName={displayName} />
        </div>
      )}
    </div>
  );
}
