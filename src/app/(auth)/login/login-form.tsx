"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { EmailOtpActionState } from "@/server/auth/email-otp";

import { sendEmailOtp, verifyEmailOtp } from "./actions";

const initialState: EmailOtpActionState = { status: "idle" };

export function LoginForm() {
  const router = useRouter();
  const [sendState, sendAction, sending] = useActionState(sendEmailOtp, initialState);
  const [verifyState, verifyAction, verifying] = useActionState(verifyEmailOtp, initialState);
  const [email, setEmail] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [inputError, setInputError] = useState("");
  const sentEmail = sendState.email ?? "";
  const sent = Boolean(sentEmail);
  const cooldown = Math.max(
    0,
    Math.ceil(((sendState.cooldownUntil ?? 0) - now) / 1000),
  );
  const emailError = inputError || sendState.fieldErrors?.email?.[0];
  const tokenError = verifyState.fieldErrors?.token?.[0];

  useEffect(() => {
    if (!sendState.cooldownUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sendState.cooldownUntil]);

  useEffect(() => {
    if (!verifyState.redirectTo) return;
    router.replace(verifyState.redirectTo);
    router.refresh();
  }, [router, verifyState.redirectTo]);

  return (
    <div className="beauty-login-form space-y-5" data-sent={sent}>
      <form action={sendAction} className="space-y-5" aria-busy={sending}>
      <div>
        <label className="sr-only" htmlFor="email">
          邮箱
        </label>
        <input
          aria-describedby={emailError ? "email-help email-error" : "email-help"}
          aria-invalid={Boolean(emailError)}
          autoComplete="email"
          className="beauty-field beauty-login-input"
          id="email"
          name="email"
          placeholder="you@example.com"
          required
          readOnly={sent || sending}
          type="email"
          value={email}
          onChange={(event) => { setEmail(event.target.value); setInputError(""); }}
          onBlur={(event) => { if (event.currentTarget.value && !event.currentTarget.validity.valid) setInputError("请输入完整的邮箱地址，例如 you@example.com。"); }}
          onInvalid={() => setInputError("请输入完整的邮箱地址，例如 you@example.com。")}
        />
        {emailError ? (
          <p className="mt-2 text-sm text-destructive" id="email-error" role="alert">
            {emailError}
          </p>
        ) : null}
      </div>

      <p id="email-help" className="text-xs leading-6 text-secondary-foreground">无需密码，我们会向你的邮箱发送验证码。</p>
      <Button className="beauty-login-submit h-12 w-full" disabled={sending || (sent && cooldown > 0)} type="submit">
        <span>{sending ? "正在发送…" : sent ? cooldown > 0 ? `${cooldown} 秒后可重新发送` : "重新发送验证码" : "获取验证码"}</span>
        <svg className="beauty-login-action-icon" data-pending={sending} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {sent ? <path d="m5 12 4 4L19 6" /> : sending ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></> : <path d="M5 12h14m-5-5 5 5-5 5" />}
        </svg>
      </Button>

      {sendState.message && !sending ? (
        <p
          aria-live="polite"
          className={
            sendState.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {sendState.message}
        </p>
      ) : null}
      </form>

      {sent ? (
        <form action={verifyAction} className="space-y-5" aria-busy={verifying}>
          <input name="email" type="hidden" value={sentEmail} />
          <div>
            <label className="sr-only" htmlFor="token">验证码</label>
            <input
              aria-describedby={tokenError ? "token-help token-error" : "token-help"}
              aria-invalid={Boolean(tokenError)}
              autoComplete="one-time-code"
              className="beauty-field beauty-login-input"
              id="token"
              inputMode="numeric"
              maxLength={10}
              name="token"
              pattern="[0-9]{6,10}"
              placeholder="邮箱验证码"
              required
              type="text"
            />
            <p id="token-help" className="mt-2 text-xs leading-6 text-secondary-foreground">验证码已发送至你的邮箱</p>
            {tokenError ? <p id="token-error" role="alert" className="mt-2 text-sm text-destructive">{tokenError}</p> : null}
          </div>
          <Button className="beauty-login-submit h-12 w-full" disabled={verifying} type="submit">
            {verifying ? "正在验证…" : "登录"}
          </Button>
          {verifyState.message && !verifying ? (
            <p aria-live="polite" className={verifyState.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {verifyState.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

