"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ChatBubble, ChatComposer, ChatShell } from "@/features/chat/chat-shell";
import type { Routine } from "@/schemas/routine";
import { usageFeedbackConversationApiResultSchema, usageFeedbackRecordedSummarySchema, type UsageFeedbackRecordedSummary } from "@/schemas/usage-feedback-conversation";

type Message = { id: string; role: "user" | "assistant"; content: string };
type PendingMessage = { id: string; content: string };
type StoredConversation = { conversationId: string; messages: Message[]; pending: PendingMessage | null; recordedSummary: UsageFeedbackRecordedSummary | null };

export function UsageFeedbackConversation({ routine }: { routine: Routine }) {
  return <UsageFeedbackSession key={routine.id} routine={routine} />;
}

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function UsageFeedbackSession({ routine }: { routine: Routine }) {
  const isClient = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const storageKey = "beauty-os:usage-feedback:" + routine.id;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => [openingMessage(routine)]);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [recordedSummary, setRecordedSummary] = useState<UsageFeedbackRecordedSummary | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!hydrated || !conversationId) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ conversationId, messages, pending, recordedSummary } satisfies StoredConversation));
    } catch {
      // Storage may be unavailable; the current conversation can still continue.
    }
  }, [conversationId, hydrated, messages, pending, recordedSummary, storageKey]);

  // Restore once after hydration, before committing any persistence effect.
  // The keyed session also prevents writing the old routine into a new key.
  if (isClient && !hydrated) {
    const stored = readStoredConversation(storageKey);
    setMessages(stored?.messages.length ? stored.messages : [openingMessage(routine)]);
    setPending(stored?.pending ?? null);
    setRecordedSummary(stored?.recordedSummary ?? null);
    setConversationId(stored?.conversationId ?? crypto.randomUUID());
    setHydrated(true);
  }

  async function send() {
    const message = text.trim();
    if (!message || busy || !hydrated || !conversationId) return;
    const messageId = pending?.content === message ? pending.id : crypto.randomUUID();
    const nextPending = { id: messageId, content: message };
    if (!pending || pending.id !== messageId) setMessages((current) => [...current, { id: messageId, role: "user", content: message }]);
    setPending(nextPending);
    setText("");
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/v1/usage-feedback-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routine_id: routine.id,
          conversation_id: conversationId,
          message_id: messageId,
          message,
          active_turn_context: messages.map((item) => (item.role === "user" ? "用户：" : "Beauty OS：") + item.content),
        }),
      });
      const payload = await response.json().catch(() => null);
      const parsed = usageFeedbackConversationApiResultSchema.safeParse(payload?.data);
      if (!response.ok || !parsed.success) throw new Error("USAGE_FEEDBACK_CONVERSATION_FAILED");
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: parsed.data.reply }]);
      setPending(null);
      if (parsed.data.saved && parsed.data.recorded_summary) {
        setRecordedSummary(parsed.data.recorded_summary);
        setNotice("已记录这次使用感受。之后安排护理时会参考这些事实。");
      }
    } catch {
      setNotice("这次反馈暂时没有记录成功，可以再试一次。");
      setText(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col overflow-hidden px-4 pb-4 pt-9 sm:px-6 lg:h-svh lg:px-0 lg:pb-5 lg:pt-14">
      <div className="mx-auto flex min-h-0 w-full max-w-[940px] flex-1 flex-col lg:mx-0 lg:ml-20 lg:mr-auto">
        <ChatShell
          composer={<ChatComposer disabled={busy || !hydrated} notice={notice} onChange={setText} onSend={() => void send()} placeholder="例如：整体挺舒服，就是某一支有点黏。" sendDisabled={busy || !hydrated || !text.trim()} value={text} />}
          description={<><span>聊聊这套护理实际用了哪些产品、感觉怎么样。</span><RoutineContext routine={routine} /></>}
          eyebrow={<Link className="underline" href={`/today/${routine.period}`}>返回{routine.period === "am" ? "早间" : "晚间"}方案</Link>}
          title="和 Beauty OS 聊聊"
        >
          {messages.map((item) => <ChatBubble key={item.id} message={item} />)}
          {busy ? <ChatBubble message={{ id: "loading", role: "assistant", content: "我在整理这次使用感受…" }} /> : null}
          {recordedSummary ? <RecordedSummary summary={recordedSummary} /> : null}
        </ChatShell>
      </div>
    </main>
  );
}

function readStoredConversation(key: string): StoredConversation | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object" || !("conversationId" in value) || !("messages" in value)) return null;
    const candidate = value as Partial<StoredConversation>;
    if (typeof candidate.conversationId !== "string" || !Array.isArray(candidate.messages)) return null;
    const messages = candidate.messages.flatMap((message, index) => {
      if (typeof message !== "object" || message === null || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return [];
      return [{ id: typeof message.id === "string" ? message.id : `legacy-message-${index}`, role: message.role, content: message.content } satisfies Message];
    });
    const pending = candidate.pending && typeof candidate.pending === "object" && typeof candidate.pending.id === "string" && typeof candidate.pending.content === "string" ? candidate.pending : null;
    const recordedSummary = usageFeedbackRecordedSummarySchema.safeParse(candidate.recordedSummary).data ?? null;
    return { conversationId: candidate.conversationId, messages, pending, recordedSummary };
  } catch {
    return null;
  }
}

function openingMessage(routine: Routine): Message {
  return {
    id: "opening",
    role: "assistant",
    content: routine.period === "pm"
      ? "今晚这套护理用下来感觉怎么样？如果有哪一支特别舒服、偏油、刺，或者其实没用，也可以直接告诉我。"
      : "今天这套护理用下来感觉怎么样？有哪一支特别舒服、不舒服，或者其实没用，都可以直接说。",
  };
}

function RoutineContext({ routine }: { routine: Routine }) {
  const products = routine.steps.map((step) => [step.product.brand_name, step.product.product_name].filter(Boolean).join(" · "));
  return <span className="mt-1 block">{formatRoutineDate(routine.routine_date)}{routine.period === "am" ? "早间护理" : "晚间护理"} · {products.length ? products.join("、") : "未安排具体产品"}</span>;
}

function RecordedSummary({ summary }: { summary: UsageFeedbackRecordedSummary }) {
  return <section className="max-w-[90%] rounded-2xl border bg-background p-5 sm:max-w-[76%]"><p className="text-sm font-medium">本次已记录</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{summary.outcome === "routine_skipped" ? "已记下这次护理没有执行。" : "已记下这次真实使用感受，之后安排护理时会参考。"}</p>{summary.products.length ? <ul className="mt-4 space-y-3">{summary.products.map((product) => <li className="text-sm leading-6" key={product.product_name}><p className="font-medium">{product.product_name}</p>{product.observations.length ? <p className="mt-1 text-muted-foreground">{product.observations.join("；")}</p> : <p className="mt-1 text-muted-foreground">已更新这款产品的本次记录。</p>}</li>)}</ul> : null}{summary.overall_note ? <p className="mt-4 text-sm leading-6 text-muted-foreground">你补充：{summary.overall_note}</p> : null}</section>;
}

function formatRoutineDate(value: string) { const [year, month, day] = value.split("-"); return `${Number(year)} 年 ${Number(month)} 月 ${Number(day)} 日 · `; }
