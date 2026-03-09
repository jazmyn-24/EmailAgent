import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase";
import { google } from "googleapis";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SearchResult {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

async function searchGmail(
  accessToken: string,
  refreshToken: string | null,
  query: string
): Promise<SearchResult[]> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 10 });
  const msgs = listRes.data.messages ?? [];
  if (msgs.length === 0) return [];

  return Promise.all(
    msgs.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const headers = detail.data.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
      return {
        id: msg.id!,
        from: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: (detail.data.snippet ?? "").slice(0, 50),
      };
    })
  );
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { messages, emailContext, emailCount, selectedEmailId, selectedEmailBody } = await request.json();

  const [{ data: tokenRow }] = await Promise.all([
    supabaseAdmin
      .from("gmail_tokens")
      .select("access_token, refresh_token")
      .eq("clerk_user_id", userId)
      .single(),
  ]);

  const focusedBlock = selectedEmailId && selectedEmailBody
    ? `\nFOCUSED EMAIL BODY:\n${selectedEmailBody}\n`
    : "";

  const systemPrompt = `You are MailMind, an AI email assistant.

INBOX (${emailCount ?? 0} emails):
${emailContext ?? ""}
${focusedBlock}
Use search_gmail when user asks about specific people, topics, or dates not in the snapshot.
Gmail syntax: from:x, subject:x, after:YYYY/MM/DD, is:unread, has:attachment

Be concise. Use markdown when helpful.

When asked to draft a reply, output ONLY the email body text — no commentary before or after, no "Here's a draft:", no "Feel free to modify", no --- separators. Just the raw reply text ready to send.`;

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(messages as Message[]).map((m) => ({ role: m.role, content: m.content })),
  ];

  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "search_gmail",
        description: "Search Gmail inbox for specific emails.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: 'e.g. "from:boss@co.com", "subject:invoice"' },
          },
          required: ["query"],
        },
      },
    },
  ];

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));

      try {
        // Stream first call — for normal responses this goes straight to client
        const firstStream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: openaiMessages,
          tools,
          tool_choice: "auto",
          stream: true,
        });

        // Collect tool call data and any direct content while streaming
        const toolCallMap: Record<number, { id: string; name: string; args: string }> = {};
        let finishReason = "";
        let hasDirectContent = false;

        for await (const chunk of firstStream) {
          const choice = chunk.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta;

          // Accumulate tool calls by index
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap[idx]) toolCallMap[idx] = { id: "", name: "", args: "" };
              if (tc.id) toolCallMap[idx].id = tc.id;
              if (tc.function?.name) toolCallMap[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCallMap[idx].args += tc.function.arguments;
            }
          }

          // Stream direct content immediately
          if (delta.content) {
            hasDirectContent = true;
            send(delta.content);
          }
        }

        // If no tool calls, we're done
        if (finishReason !== "tool_calls" || !Object.keys(toolCallMap).length) {
          controller.close();
          return;
        }

        // Tool calls — run all searches in parallel
        const toolCalls = Object.values(toolCallMap);
        const queries = toolCalls.map((tc) => JSON.parse(tc.args).query as string);

        send(queries.map((q) => `🔍 *Searched Gmail for "${q}"*`).join("\n") + "\n\n");

        const searchResults = await Promise.all(
          toolCalls.map(async (tc) => {
            const query = JSON.parse(tc.args).query as string;
            let result = "No emails found.";
            if (tokenRow) {
              try {
                const results = await searchGmail(
                  tokenRow.access_token,
                  tokenRow.refresh_token,
                  query
                );
                if (results.length > 0) {
                  result = results
                    .map((e, i) => `[${i + 1}] ${e.from} | ${e.subject} | ${e.date} | ${e.snippet}`)
                    .join("\n");
                }
              } catch {
                result = "Search failed.";
              }
            }
            return { id: tc.id, name: tc.name, args: tc.args, result };
          })
        );

        // Build follow-up messages with all tool responses
        const followUpMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          ...openaiMessages,
          {
            role: "assistant",
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          },
          ...searchResults.map((r) => ({
            role: "tool" as const,
            tool_call_id: r.id,
            content: r.result,
          })),
        ];

        // Stream follow-up response
        const followUpStream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: followUpMessages,
          stream: true,
        });

        for await (const chunk of followUpStream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) send(text);
        }

        // Suppress unused variable warning
        void hasDirectContent;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send(`\n\n**Error:** ${msg}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
