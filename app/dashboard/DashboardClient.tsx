"use client";

import { useState, useRef, useEffect } from "react";

interface Email {
  id: string;
  from: string;
  subject: string;
  date: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  isDraft?: boolean;
}

interface Props {
  emails: Email[];
  emailContext: string;
  displayName: string;
}

function parseSender(from: string) {
  const match = from.match(/^"?([^"<]+)"?\s*<?[^>]*>?$/);
  return match ? match[1].trim() : from;
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return d.toLocaleString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function renderMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h3 class='font-bold text-sm mt-2 mb-1'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='font-bold text-sm mt-2 mb-1'>$1</h2>")
    .replace(/^- (.+)$/gm, "<li class='ml-4 list-disc'>$1</li>")
    .replace(/(<li.*<\/li>\n?)+/g, (m) => `<ul class='my-1 space-y-0.5'>${m}</ul>`)
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

const SUGGESTED_PROMPTS = [
  "Summarize my inbox",
  "Any action items today?",
  "Which emails need my attention?",
  "Who emailed me most recently?",
];

export default function DashboardClient({ emails, emailContext, displayName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmailBody, setSelectedEmailBody] = useState<string | null>(null);
  const [isBodyLoading, setIsBodyLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string, markAsDraft = false) {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const assistantPlaceholder: Message = { role: "assistant", content: "", isDraft: markAsDraft };
    setMessages([...newMessages, assistantPlaceholder]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          emailContext,
          emailCount: emails.length,
          selectedEmailId,
          selectedEmailBody,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages([...newMessages, { role: "assistant", content: fullText, isDraft: markAsDraft }]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages([
        ...newMessages,
        { role: "assistant", content: `**Error:** ${msg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const selectedEmail = selectedEmailId ? emails.find((e) => e.id === selectedEmailId) : null;

  async function selectEmail(id: string | null) {
    setSelectedEmailId(id);
    setSelectedEmailBody(null);
    if (id) {
      setIsBodyLoading(true);
      try {
        const res = await fetch(`/api/gmail/email/${id}`);
        if (res.ok) {
          const { body } = await res.json();
          setSelectedEmailBody(body);
        }
      } catch {
        // silently fail — body just won't be in context
      } finally {
        setIsBodyLoading(false);
      }
    }
  }

  function draftReply() {
    if (!selectedEmail) return;
    const prompt = `Draft a reply to this email from ${parseSender(selectedEmail.from)} about "${selectedEmail.subject}"`;
    sendMessage(prompt, true);
  }

  async function copyToClipboard(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      // clipboard not available
    }
  }

  return (
    <div className="flex h-full">
      {/* Left panel — email list */}
      <aside className="w-[30%] flex-shrink-0 border-r border-zinc-200 flex flex-col bg-zinc-50">
        <div className="px-4 py-3 border-b border-zinc-200 bg-white">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Inbox</p>
          <p className="text-xs text-zinc-400 mt-0.5">{emails.length} recent emails</p>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-zinc-100">
          {emails.map((email) => {
            const isSelected = email.id === selectedEmailId;
            return (
              <li
                key={email.id}
                onClick={() => selectEmail(isSelected ? null : email.id)}
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-violet-50 border-l-2 border-l-violet-500"
                    : "hover:bg-white border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className={`text-xs font-semibold truncate ${isSelected ? "text-violet-700" : "text-zinc-800"}`}>
                    {parseSender(email.from)}
                  </span>
                  <span className="text-[10px] text-zinc-400 flex-shrink-0">
                    {formatDate(email.date)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 truncate leading-relaxed">
                  {email.subject || "(no subject)"}
                </p>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Right panel — preview + chat */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">

        {/* Email preview pane */}
        {selectedEmail ? (
          <div className="flex-shrink-0 border-b border-zinc-200 bg-zinc-50 flex flex-col" style={{ maxHeight: "220px" }}>
            {/* Preview header */}
            <div className="px-6 py-3 flex items-start justify-between gap-4 border-b border-zinc-100 bg-white flex-shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{selectedEmail.subject || "(no subject)"}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  From: <span className="text-zinc-700">{parseSender(selectedEmail.from)}</span>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  {formatDate(selectedEmail.date)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={draftReply}
                  disabled={isLoading || isBodyLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Draft Reply
                </button>
                <button
                  onClick={() => selectEmail(null)}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors text-sm"
                >
                  ✕
                </button>
              </div>
            </div>
            {/* Preview body */}
            <div className="px-6 py-3 overflow-y-auto flex-1">
              {isBodyLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Loading email...
                </div>
              ) : selectedEmailBody ? (
                <p className="text-xs text-zinc-600 whitespace-pre-wrap leading-relaxed">{selectedEmailBody}</p>
              ) : (
                <p className="text-xs text-zinc-400 italic">Could not load email body.</p>
              )}
            </div>
          </div>
        ) : (
          /* Chat header when no email selected */
          <div className="px-6 py-3 border-b border-zinc-200 bg-white flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-semibold text-zinc-900">MailMind AI</p>
              <p className="text-xs text-zinc-400">{emails.length} emails loaded · Ask anything</p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center pb-8">
              <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-zinc-800 mb-1">
                Hi {displayName}, I&apos;m MailMind
              </p>
              <p className="text-sm text-zinc-500 max-w-sm mb-6">
                I have your last {emails.length} emails loaded. Ask me anything about your inbox.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-violet-600 flex-shrink-0 flex items-center justify-center mr-2 mt-0.5">
                  <span className="text-white text-[10px] font-bold">M</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5 max-w-[75%]">
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-violet-600 text-white rounded-br-sm"
                      : "bg-zinc-100 text-zinc-800 rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    isLoading && i === messages.length - 1 && msg.content === "" ? (
                      <div className="flex items-center gap-1 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                    )
                  ) : (
                    msg.content
                  )}
                </div>
                {/* Copy button for draft replies */}
                {msg.role === "assistant" && msg.isDraft && msg.content && !(isLoading && i === messages.length - 1) && (
                  <button
                    onClick={() => copyToClipboard(msg.content, i)}
                    className="self-start flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                  >
                    {copiedIdx === i ? (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy Reply
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-zinc-200 bg-white flex-shrink-0">
          <div className="flex items-end gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your inbox..."
              className="flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 resize-none outline-none leading-relaxed"
              style={{ minHeight: "24px", maxHeight: "120px" }}
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-400 text-center">
            Enter to send · Shift+Enter for new line · Click an email on the left to focus it
          </p>
        </div>
      </div>
    </div>
  );
}
