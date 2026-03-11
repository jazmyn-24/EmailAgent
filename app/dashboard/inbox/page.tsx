import { currentUser } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchEmails } from "@/lib/gmail";
import { scorePriorities } from "@/lib/scoring";
import type { ScoredEmail } from "@/lib/types";
import DashboardClient from "../DashboardClient";
import Link from "next/link";

export default async function InboxPage() {
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

      const raw = await fetchEmails(tokenRow.access_token, tokenRow.refresh_token);
      const scores = await scorePriorities(raw, promoDomainsLearned);

      emails = raw.map((e, i) => ({
        ...e,
        priority: scores[i].score,
        reason: scores[i].reason,
      }));

      const priorityLabel = (p: number) => (p === 1 ? "HIGH" : p === 2 ? "MED" : "LOW");
      emailContext = emails
        .map(
          (e, i) =>
            `[${i + 1}] [${priorityLabel(e.priority)}] ${e.from} | ${e.subject} | ${e.date}${e.snippet ? ` | ${e.snippet.slice(0, 50)}` : ""}`
        )
        .join("\n");
    } catch {
      // token expired or invalid
    }
  }

  if (!tokenRow || emails.length === 0) {
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
          <p className="text-sm text-zinc-500 mb-6">Connect Gmail to chat with your inbox using AI.</p>
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

  return (
    <div className="h-full overflow-hidden">
      <DashboardClient emails={emails} emailContext={emailContext} displayName={displayName} />
    </div>
  );
}
