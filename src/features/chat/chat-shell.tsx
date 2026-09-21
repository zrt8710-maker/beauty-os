"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatShellMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

export function ChatShell({
  actions,
  children,
  composer,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  composer?: ReactNode;
  description: ReactNode;
  eyebrow?: ReactNode;
  title: string;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="relative min-h-[64px] shrink-0 py-1 pt-11 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:pt-1">
        <div>
          {eyebrow ? <div className="mb-2 text-sm font-medium text-brand-deep">{eyebrow}</div> : null}
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground lg:text-[28px]">{title}</h1>
          <div className="mt-2 text-xs text-muted-foreground">{description}</div>
        </div>
        {actions ? <div className="absolute right-0 top-0 flex shrink-0 items-center gap-1 sm:static sm:gap-2">{actions}</div> : null}
      </header>
      <div aria-label="Conversation messages" className="relative min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pt-7">
        {children}
      </div>
      {composer}
    </section>
  );
}

export function ChatBubble({ message }: { message: ChatShellMessage }) {
  return (
    <div
      data-message-role={message.role}
      className={message.role === "user"
        ? "ml-auto w-fit max-w-[82%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-[var(--shadow-button-soft)] sm:max-w-[64%]"
        : "w-fit max-w-[90%] whitespace-pre-line rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm leading-6 shadow-[var(--shadow-card)] sm:max-w-[76%]"}
    >
      {message.role === "assistant" ? <p className="mb-1 text-xs text-muted-foreground">Beauty OS</p> : null}
      {message.content}
    </div>
  );
}

export function ChatComposer({
  actions,
  disabled = false,
  maxLength = 2000,
  notice,
  onChange,
  onSend,
  placeholder,
  roomy = false,
  sendDisabled = false,
  value,
}: {
  actions?: ReactNode;
  disabled?: boolean;
  maxLength?: number;
  notice?: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  roomy?: boolean;
  sendDisabled?: boolean;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(120, Math.max(roomy ? 52 : 40, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 120 ? "auto" : "hidden";
  }, [value, roomy]);

  return (
    <div aria-label="Conversation composer" className={cn("relative z-10 max-h-[176px] shrink-0 rounded-2xl border border-border/80 shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:shadow-[var(--shadow-button-soft)]", roomy ? "beauty-home-composer px-0 pt-0 pb-2.5" : "bg-card p-2.5")}>
      <textarea
        ref={textareaRef}
        rows={roomy ? 1 : 2}
        className={cn("max-h-[120px] w-full resize-none overflow-y-hidden border-0 bg-transparent text-sm outline-none focus-visible:outline-none", roomy ? "block min-h-[52px] px-5 pt-4 pb-3 leading-6" : "min-h-10 px-1 py-0 leading-5")}
        aria-label="输入消息"
        disabled={disabled}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      <div className={cn("flex items-end justify-between gap-2", roomy ? "px-2.5" : "mt-1")}>
        <div className="flex min-w-0 flex-wrap items-center gap-1">{actions}</div>
        <Button aria-label="发送" className="beauty-send-button h-8 w-8" disabled={sendDisabled} onClick={onSend} size="icon" type="button">
          <SendIcon />
        </Button>
      </div>
      {notice ? <ChatStatus>{notice}</ChatStatus> : null}
    </div>
  );
}

export function ChatStatus({ children, className }: { children: ReactNode; className?: string }) {
  return <p aria-live="polite" className={cn("mt-2 text-sm text-muted-foreground", className)}>{children}</p>;
}

function SendIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}
