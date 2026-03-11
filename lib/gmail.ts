import { google } from "googleapis";
import { ScoredEmail } from "./types";

export async function fetchEmails(
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
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
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

export async function fetchSentCount(
  accessToken: string,
  refreshToken: string | null
): Promise<number> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const after = `${yyyy}/${mm}/${dd}`;

  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: `in:sent after:${after}`,
      maxResults: 50,
    });
    return res.data.messages?.length ?? 0;
  } catch {
    return 0;
  }
}
