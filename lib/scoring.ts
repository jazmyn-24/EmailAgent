import OpenAI from "openai";
import { ScoredEmail } from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function scorePriorities(
  emails: Omit<ScoredEmail, "priority" | "reason">[],
  promoDomainsLearned: string[]
): Promise<{ score: 1 | 2 | 3; reason: string }[]> {
  if (emails.length === 0) return [];

  const promoHint = promoDomainsLearned.length
    ? `\nUser-marked promo domains (always score 3): ${promoDomainsLearned.join(", ")}`
    : "";

  const list = emails
    .map(
      (e, i) =>
        `${i + 1}. From: ${e.from} | Subject: ${e.subject} | Snippet: ${(e.snippet ?? "").slice(0, 100)}`
    )
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
