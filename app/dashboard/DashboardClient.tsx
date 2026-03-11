"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ScoredEmail } from "@/lib/types";

type Email = ScoredEmail;
type Filter = "all" | "high" | "medium" | "low";

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

interface Attachment {
  name: string;
  size: number;
  mimeType: string;
  base64: string;
}

interface SendModal {
  to: string;
  senderName: string;
  subject: string;
  body: string;
}

type ThumbState = "up" | "down" | null;
interface FeedbackState {
  thumb: ThumbState;
  isPromo: boolean;
  localPriority?: 1 | 2 | 3;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PROMO_KEYWORDS = ["sale", "deal", "offer", "% off", "discount", "promo", "shop now"];

// ── helpers ────────────────────────────────────────────────────────────────

function parseSender(from: string) {
  const match = from.match(/^"?([^"<]+)"?\s*<?[^>]*>?$/);
  return match ? match[1].trim() : from;
}

function parseEmail(from: string) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function parseDomain(from: string) {
  const addr = parseEmail(from);
  const parts = addr.split("@");
  return parts[1]?.toLowerCase() ?? "";
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return d.toLocaleString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function extractDraftBody(text: string): string {
  const fenced = text.match(/---+\s*\n([\s\S]*?)\n\s*---+/);
  if (fenced) return fenced[1].trim();
  const lines = text.split("\n");
  let start = 0;
  if (lines[0] && /^.{0,80}:\s*$/.test(lines[0].trim())) start = 1;
  while (start < lines.length && lines[start].trim() === "") start++;
  let end = lines.length;
  while (end > start && /^(feel free|let me know|hope this|please let|don't hesitate|best regards note|note:|p\.s\.)/i.test(lines[end - 1].trim())) end--;
  return lines.slice(start, end).join("\n").trim();
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── sub-components ─────────────────────────────────────────────────────────

function PriorityDot({ priority, reason }: { priority: 1 | 2 | 3; reason: string }) {
  const [show, setShow] = useState(false);
  const colors = { 1: "bg-red-500", 2: "bg-yellow-400", 3: "bg-zinc-300" };
  return (
    <span className="relative flex-shrink-0 mt-[3px]" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className={`block w-2 h-2 rounded-full ${colors[priority]} cursor-help`} />
      {show && (
        <span className="absolute left-4 top-0 z-20 w-52 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white leading-snug shadow-lg pointer-events-none whitespace-normal">
          {reason}
        </span>
      )}
    </span>
  );
}

const SUGGESTED_PROMPTS = [
  "Summarize my inbox",
  "Any action items today?",
  "Which emails need my attention?",
  "Who emailed me most recently?",
];

// ── main component ─────────────────────────────────────────────────────────

export default function DashboardClient({ emails, emailContext, displayName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmailBody, setSelectedEmailBody] = useState<string | null>(null);
  const [isBodyLoading, setIsBodyLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [isReadingEmail, setIsReadingEmail] = useState(false);
  const [emailSentences, setEmailSentences] = useState<string[]>([]);
  const [highlightedSentenceIdx, setHighlightedSentenceIdx] = useState<number | null>(null);
  const emailReadingRef = useRef<{ active: boolean }>({ active: false });
  const [sendModal, setSendModal] = useState<SendModal | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsMsgIdx, setAttachmentsMsgIdx] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // feedback: keyed by email.id
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachMsgIdx = useRef<number | null>(null);

  // ── derived ──────────────────────────────────────────────────────────────

  const displayedEmails = useMemo(() => {
    const withOverrides = emails.map((e) => ({
      ...e,
      priority: (feedback[e.id]?.localPriority ?? e.priority) as 1 | 2 | 3,
    }));
    const filtered =
      filter === "high" ? withOverrides.filter((e) => e.priority === 1) :
      filter === "medium" ? withOverrides.filter((e) => e.priority === 2) :
      filter === "low" ? withOverrides.filter((e) => e.priority === 3) :
      withOverrides;
    return [...filtered].sort((a, b) => a.priority - b.priority);
  }, [emails, filter, feedback]);

  const highEmails = useMemo(() => emails.filter((e) => (feedback[e.id]?.localPriority ?? e.priority) === 1), [emails, feedback]);
  const mostUrgent = highEmails[0] ?? null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── chat ─────────────────────────────────────────────────────────────────

  async function sendMessage(text: string, markAsDraft = false) {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages([...newMessages, { role: "assistant", content: "", isDraft: markAsDraft }]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, emailContext, emailCount: emails.length, selectedEmailId, selectedEmailBody }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);

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
      setMessages([...newMessages, { role: "assistant", content: `**Error:** ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  // ── email selection ───────────────────────────────────────────────────────

  const selectedEmail = selectedEmailId ? emails.find((e) => e.id === selectedEmailId) : null;

  async function selectEmail(id: string | null) {
    stopEmailReading();
    setSelectedEmailId(id);
    setSelectedEmailBody(null);
    if (!id) return;
    setIsBodyLoading(true);
    try {
      const res = await fetch(`/api/gmail/email/${id}`);
      if (res.ok) setSelectedEmailBody((await res.json()).body);
    } catch { /* silent */ } finally { setIsBodyLoading(false); }
  }

  function draftReply() {
    if (!selectedEmail) return;
    sendMessage(`Draft a reply to this email from ${parseSender(selectedEmail.from)} about "${selectedEmail.subject}"`, true);
  }

  // ── feedback ─────────────────────────────────────────────────────────────

  async function saveFeedback(email: Email, feedbackType: "thumbs_up" | "thumbs_down" | "mark_promo", correctPriority: 1 | 2 | 3) {
    // Optimistic local update
    setFeedback((prev) => ({
      ...prev,
      [email.id]: {
        thumb: feedbackType === "thumbs_up" ? "up" : feedbackType === "thumbs_down" ? "down" : prev[email.id]?.thumb ?? null,
        isPromo: feedbackType === "mark_promo" || (prev[email.id]?.isPromo ?? false),
        localPriority: correctPriority,
      },
    }));

    try {
      await fetch("/api/priority/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: email.id,
          sender: email.from,
          senderDomain: parseDomain(email.from),
          subject: email.subject,
          originalPriority: email.priority,
          correctPriority,
          feedbackType,
        }),
      });
    } catch { /* silent — local state already updated */ }
  }

  function handleThumbsUp(email: Email) {
    saveFeedback(email, "thumbs_up", email.priority);
    showToast("Feedback saved ✓");
  }

  function handleThumbsDown(email: Email) {
    // Downgrade: 1→2, 2→3, 3→3
    const corrected: 1 | 2 | 3 = email.priority === 1 ? 2 : 3;
    saveFeedback(email, "thumbs_down", corrected);
    showToast("Priority lowered");
  }

  function handleMarkPromo(email: Email) {
    saveFeedback(email, "mark_promo", 3);
    showToast("Marked as promo — AI will learn this sender");
  }

  function showToast(msg: string, ms = 3000) {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }

  // ── attachments ───────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const msgIdx = pendingAttachMsgIdx.current;
    if (msgIdx !== null) setAttachmentsMsgIdx(msgIdx);
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        showToast("File too large — Gmail limit is 25MB", 4000);
        continue;
      }
      try {
        const base64 = await readFileAsBase64(file);
        setAttachments((prev) => [...prev, { name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", base64 }]);
      } catch { showToast("Failed to read file"); }
    }
  }, []);

  // ── send modal ────────────────────────────────────────────────────────────

  function openSendModal(msg: Message) {
    if (!selectedEmail) return;
    setSendModal({
      to: parseEmail(selectedEmail.from),
      senderName: parseSender(selectedEmail.from),
      subject: selectedEmail.subject.startsWith("Re:") ? selectedEmail.subject : `Re: ${selectedEmail.subject}`,
      body: extractDraftBody(msg.content),
    });
  }

  function closeModal() { setSendModal(null); setAttachments([]); setAttachmentsMsgIdx(null); }

  async function confirmSend() {
    if (!sendModal) return;
    setIsSending(true);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: sendModal.to, subject: sendModal.subject, body: sendModal.body,
          attachments: attachments.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Send failed");
      closeModal();
      showToast(`Reply sent to ${sendModal.senderName} ✓`);
    } catch (err: unknown) {
      showToast(`Failed to send: ${err instanceof Error ? err.message : "Unknown error"}`, 4000);
    } finally { setIsSending(false); }
  }

  function stopEmailReading() {
    emailReadingRef.current.active = false;
    window.speechSynthesis.cancel();
    setIsReadingEmail(false);
    setHighlightedSentenceIdx(null);
    setEmailSentences([]);
  }

  function speakEmailSentence(sentences: string[], idx: number) {
    if (idx >= sentences.length || !emailReadingRef.current.active) {
      setIsReadingEmail(false);
      setHighlightedSentenceIdx(null);
      return;
    }
    setHighlightedSentenceIdx(idx);
    const utter = new SpeechSynthesisUtterance(sentences[idx]);
    utter.onend = () => {
      if (!emailReadingRef.current.active) return;
      speakEmailSentence(sentences, idx + 1);
    };
    utter.onerror = () => { setIsReadingEmail(false); setHighlightedSentenceIdx(null); };
    window.speechSynthesis.speak(utter);
  }

  function speakEmail() {
    if (isReadingEmail) { stopEmailReading(); return; }
    if (!selectedEmailBody) return;
    // Stop any chat TTS in progress
    setSpeakingIdx(null);
    window.speechSynthesis.cancel();
    // Split into sentences on . ! ? followed by space/newline
    const sentences = selectedEmailBody
      .replace(/([.!?])\s+/g, "$1\n")
      .split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 1);
    if (sentences.length === 0) return;
    setEmailSentences(sentences);
    setIsReadingEmail(true);
    emailReadingRef.current = { active: true };
    speakEmailSentence(sentences, 0);
  }

  function speak(text: string, idx: number) {
    stopEmailReading(); // stop email reading if in progress
    window.speechSynthesis.cancel();
    if (speakingIdx === idx) { setSpeakingIdx(null); return; }
    // Strip markdown syntax before speaking
    const plain = text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/^- /gm, "")
      .replace(/\n+/g, " ")
      .trim();
    const utter = new SpeechSynthesisUtterance(plain);
    utter.onend = () => setSpeakingIdx(null);
    utter.onerror = () => setSpeakingIdx(null);
    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utter);
  }

  async function copyToClipboard(text: string, idx: number) {
    try { await navigator.clipboard.writeText(text); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 2000); } catch { /* silent */ }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">

      {/* ── Left panel ──────────────────────────────────────────────────── */}
      <aside className="w-[30%] flex-shrink-0 border-r border-zinc-200 flex flex-col bg-zinc-50">

        {/* Daily digest card */}
        {highEmails.length > 0 && (
          <div className="mx-3 mt-3 rounded-xl border px-3 py-2.5 flex-shrink-0" style={{ background: "#f5f3ff", borderColor: "#ddd6fe" }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
              <p className="text-[11px] font-semibold text-violet-700">
                ✨ {highEmails.length} email{highEmails.length > 1 ? "s" : ""} need{highEmails.length === 1 ? "s" : ""} your attention today
              </p>
            </div>
            {mostUrgent && (
              <p className="text-[11px] text-zinc-500 truncate pl-3">
                Most urgent: <span className="font-medium text-zinc-600">{mostUrgent.subject || "(no subject)"}</span>
                {" "}from {parseSender(mostUrgent.from)}
              </p>
            )}
          </div>
        )}

        {/* Header + filter */}
        <div className="px-4 py-3 border-b border-zinc-200 bg-white flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Inbox</p>
            <p className="text-xs text-zinc-400">{displayedEmails.length} emails</p>
          </div>
          <div className="flex gap-1">
            {(["all", "high", "medium", "low"] as Filter[]).map((f) => {
              const labels: Record<Filter, string> = { all: "All", high: "🔴", medium: "🟡", low: "⚪" };
              const fullLabels: Record<Filter, string> = { all: "All", high: "High", medium: "Med", low: "Low" };
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded-md py-1 text-[10px] font-medium transition-colors ${filter === f ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}
                >
                  {labels[f]} {fullLabels[f]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Email list */}
        <ul className="flex-1 overflow-y-auto divide-y divide-zinc-100">
          {displayedEmails.map((email) => {
            const isSelected = email.id === selectedEmailId;
            const fb = feedback[email.id];
            const effectivePriority = fb?.localPriority ?? email.priority;
            return (
              <li
                key={email.id}
                onClick={() => selectEmail(isSelected ? null : email.id)}
                className={`px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? "bg-violet-50 border-l-2 border-l-violet-500" : "hover:bg-white border-l-2 border-l-transparent"}`}
              >
                <div className="flex items-start gap-2">
                  <PriorityDot priority={effectivePriority} reason={email.reason} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={`text-xs font-semibold truncate ${isSelected ? "text-violet-700" : "text-zinc-800"}`}>
                        {parseSender(email.from)}
                      </span>
                      <span className="text-[10px] text-zinc-400 flex-shrink-0">{formatDate(email.date)}</span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate leading-relaxed">{email.subject || "(no subject)"}</p>

                    {/* Feedback + mark promo row */}
                    <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                      {/* Thumbs up */}
                      <button
                        onClick={() => handleThumbsUp(email)}
                        title="Priority is correct"
                        className={`text-[10px] rounded px-1 py-0.5 transition-colors ${fb?.thumb === "up" ? "bg-green-100 text-green-700" : "text-zinc-400 hover:text-green-600 hover:bg-green-50"}`}
                      >
                        👍
                      </button>
                      {/* Thumbs down */}
                      <button
                        onClick={() => handleThumbsDown(email)}
                        title="Lower this priority"
                        className={`text-[10px] rounded px-1 py-0.5 transition-colors ${fb?.thumb === "down" ? "bg-red-100 text-red-600" : "text-zinc-400 hover:text-red-500 hover:bg-red-50"}`}
                      >
                        👎
                      </button>
                      {/* Mark as promo */}
                      {effectivePriority !== 3 && !PROMO_KEYWORDS.some(k => email.subject.toLowerCase().includes(k)) && (
                        <button
                          onClick={() => handleMarkPromo(email)}
                          title="Mark as promotional — AI will learn this sender"
                          className={`text-[10px] rounded px-1.5 py-0.5 transition-colors ${fb?.isPromo ? "bg-orange-100 text-orange-600" : "text-zinc-400 hover:text-orange-500 hover:bg-orange-50"}`}
                        >
                          {fb?.isPromo ? "Promo ✓" : "Promo"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
          {displayedEmails.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-zinc-400">No emails in this category</li>
          )}
        </ul>
      </aside>

      {/* ── Right panel ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">

        {/* Email preview pane */}
        {selectedEmail ? (
          <div className="flex-shrink-0 border-b border-zinc-200 bg-zinc-50 flex flex-col" style={{ maxHeight: "220px" }}>
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
                {/* Read Aloud */}
                <button
                  onClick={speakEmail}
                  disabled={isBodyLoading || !selectedEmailBody}
                  title={isReadingEmail ? "Stop reading" : "Read aloud"}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isReadingEmail ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"}`}
                >
                  {isReadingEmail ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  )}
                  {isReadingEmail ? "Stop" : "Read Aloud"}
                </button>
                <button onClick={() => selectEmail(null)} className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors text-sm">✕</button>
              </div>
            </div>
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
                <p className="text-xs text-zinc-600 whitespace-pre-wrap leading-relaxed">
                  {emailSentences.length > 0 ? (
                    emailSentences.map((sentence, si) => (
                      <span
                        key={si}
                        className={`transition-colors duration-150 ${si === highlightedSentenceIdx ? "bg-yellow-100 rounded px-0.5" : ""}`}
                      >
                        {sentence}{si < emailSentences.length - 1 ? " " : ""}
                      </span>
                    ))
                  ) : selectedEmailBody}
                </p>
              ) : (
                <p className="text-xs text-zinc-400 italic">Could not load email body.</p>
              )}
            </div>
          </div>
        ) : (
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
              <p className="text-base font-semibold text-zinc-800 mb-1">Hi {displayName}, I&apos;m MailMind</p>
              <p className="text-sm text-zinc-500 max-w-sm mb-6">I have your last {emails.length} emails loaded. Ask me anything about your inbox.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button key={p} onClick={() => sendMessage(p)} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors">{p}</button>
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
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === "user" ? "bg-violet-600 text-white rounded-br-sm" : "bg-zinc-100 text-zinc-800 rounded-bl-sm"}`}>
                  {msg.role === "assistant" ? (
                    isLoading && i === messages.length - 1 && msg.content === "" ? (
                      <div className="flex items-center gap-1 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                        <button
                          onClick={() => speak(msg.content, i)}
                          title={speakingIdx === i ? "Stop" : "Read aloud"}
                          className="flex-shrink-0 mt-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                        >
                          {speakingIdx === i ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )
                  ) : msg.content}
                </div>

                {/* Draft action buttons */}
                {msg.role === "assistant" && msg.isDraft && msg.content && !(isLoading && i === messages.length - 1) && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => copyToClipboard(msg.content, i)} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-colors">
                        {copiedIdx === i ? (
                          <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Copied!</>
                        ) : (
                          <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy</>
                        )}
                      </button>
                      {selectedEmail && (
                        <button onClick={() => openSendModal(msg)} className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 hover:border-violet-300 transition-colors">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                          Send Reply
                        </button>
                      )}
                      <button
                        onClick={() => { pendingAttachMsgIdx.current = i; fileInputRef.current?.click(); }}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                        Attach
                      </button>
                    </div>
                    {attachmentsMsgIdx === i && attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {attachments.map((att, j) => (
                          <div key={j} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                            <span className="max-w-[120px] truncate font-medium">{att.name}</span>
                            <span className="text-zinc-400">{formatSize(att.size)}</span>
                            <button onClick={() => setAttachments((p) => p.filter((_, k) => k !== j))} className="text-zinc-400 hover:text-zinc-700 transition-colors">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
              ref={inputRef} rows={1} value={input}
              onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your inbox..."
              className="flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 resize-none outline-none leading-relaxed"
              style={{ minHeight: "24px", maxHeight: "120px" }} disabled={isLoading}
            />
            <button onClick={() => sendMessage(input)} disabled={!input.trim() || isLoading} className="flex-shrink-0 w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {isLoading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-400 text-center">Enter to send · Shift+Enter for new line · Click an email on the left to focus it</p>
        </div>
      </div>

      {/* ── Hidden file input ────────────────────────────────────────────── */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

      {/* ── Send modal ───────────────────────────────────────────────────── */}
      {sendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !isSending && closeModal()} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Send this reply?</h2>
              <p className="text-sm text-zinc-500 mt-0.5">To: <span className="font-medium text-zinc-700">{sendModal.senderName}</span> <span className="text-zinc-400">({sendModal.to})</span></p>
              <p className="text-xs text-zinc-400 mt-0.5">Subject: {sendModal.subject}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 max-h-40 overflow-y-auto">
              <p className="text-xs text-zinc-700 whitespace-pre-wrap leading-relaxed">{sendModal.body}</p>
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    <span className="max-w-[140px] truncate font-medium">{att.name}</span>
                    <span className="text-zinc-400">{formatSize(att.size)}</span>
                    <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="ml-0.5 text-zinc-400 hover:text-zinc-700 transition-colors">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <button onClick={() => { pendingAttachMsgIdx.current = attachmentsMsgIdx; fileInputRef.current?.click(); }} disabled={isSending} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-50 transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                Attach
              </button>
              <div className="flex gap-2">
                <button onClick={closeModal} disabled={isSending} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors">Cancel</button>
                <button onClick={confirmSend} disabled={isSending} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                  {isSending ? (
                    <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>Sending...</>
                  ) : (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>Send</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith("Failed") || toast.startsWith("File too large") ? "bg-red-600 text-white" : "bg-zinc-900 text-white"}`}>
            {!toast.startsWith("Failed") && !toast.startsWith("File too large") && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            )}
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
