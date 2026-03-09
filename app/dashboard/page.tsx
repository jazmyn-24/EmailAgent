import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { google } from "googleapis";
import DashboardClient from "./DashboardClient";

interface Email {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

async function fetchEmails(accessToken: string, refreshToken: string | null): Promise<Email[]> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const listRes = await gmail.users.messages.list({ userId: "me", maxResults: 20 });
  const messages = listRes.data.messages ?? [];

  const emails = await Promise.all(
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

  return emails;
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
      emails = await fetchEmails(tokenRow.access_token, tokenRow.refresh_token);
      emailContext = emails
        .map(
          (e, i) =>
            `[${i + 1}] ${e.from} | ${e.subject} | ${e.date}${e.snippet ? ` | ${e.snippet.slice(0, 50)}` : ""}`
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
