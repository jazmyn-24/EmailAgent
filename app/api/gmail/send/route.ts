import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { google } from "googleapis";

interface Attachment {
  name: string;
  mimeType: string;
  base64: string;
}

function buildMessage(
  to: string,
  subject: string,
  body: string,
  attachments: Attachment[]
): string {
  if (attachments.length === 0) {
    return [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n");
  }

  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    body,
  ];

  for (const att of attachments) {
    // Fold base64 into 76-char lines as required by RFC 2045
    const folded = att.base64.replace(/(.{76})/g, "$1\r\n").trimEnd();
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.name}"`,
      `Content-Disposition: attachment; filename="${att.name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      folded
    );
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { to, subject, body, attachments = [] } = await request.json();
  if (!to || !subject || !body) {
    return NextResponse.json({ error: "Missing to, subject, or body" }, { status: 400 });
  }

  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens")
    .select("access_token, refresh_token")
    .eq("clerk_user_id", userId)
    .single();

  if (!tokenRow) return NextResponse.json({ error: "Gmail not connected" }, { status: 404 });

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const raw = buildMessage(to, subject, body, attachments as Attachment[]);
  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });

  return NextResponse.json({ success: true });
}
