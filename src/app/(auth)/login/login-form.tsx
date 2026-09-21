"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import type { LoginActionState } from "@/server/auth/request-magic-link";

import { sendMagicLink } from "./actions";

const initialState: LoginActionState = { status: "idle" };

export function LoginForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initialState);
  const [edited, setEdited] = useState(false);
  const [inputError, setInputError] = useState("");
  const error = inputError || (!edited ? state.fieldErrors?.email?.[0] : undefined);
  const sent = state.status === "success" && !edited && !pending;

  return (
    <form action={action} onSubmit={() => setEdited(false)} className="beauty-login-form space-y-5" aria-busy={pending} data-sent={sent}>
      <div>
        <label className="sr-only" htmlFor="email">
          邮箱
        </label>
        <input
          aria-describedby={error ? "email-help email-error" : "email-help"}
          aria-invalid={Boolean(error)}
          autoComplete="email"
          className="beauty-field beauty-login-input"
          id="email"
          name="email"
          placeholder="you@example.com"
          required
          readOnly={pending}
          type="email"
          onChange={() => { setEdited(true); setInputError(""); }}
          onBlur={(event) => { if (event.currentTarget.value && !event.currentTarget.validity.valid) setInputError("请输入完整的邮箱地址，例如 you@example.com。"); }}
          onInvalid={() => setInputError("请输入完整的邮箱地址，例如 you@example.com。")}
        />
        {error ? (
          <p className="mt-2 text-sm text-destructive" id="email-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <p id="email-help" className="text-xs leading-6 text-secondary-foreground">无需密码，我们会向你的邮箱发送安全登录链接。</p>
      <Button className="beauty-login-submit h-12 w-full" disabled={pending} type="submit">
        <span>{pending ? "正在发送…" : sent ? "重新发送登录链接" : "发送登录链接"}</span>
        <svg className="beauty-login-action-icon" data-pending={pending} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {sent ? <path d="m5 12 4 4L19 6" /> : pending ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></> : <path d="M5 12h14m-5-5 5 5-5 5" />}
        </svg>
      </Button>

      {state.message && !edited && !pending ? (
        <p
          aria-live="polite"
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

