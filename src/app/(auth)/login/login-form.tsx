"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { LoginActionState } from "@/server/auth/request-magic-link";

import { sendMagicLink } from "./actions";

const initialState: LoginActionState = { status: "idle" };

export function LoginForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initialState);

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          邮箱
        </label>
        <input
          aria-describedby="email-error"
          autoComplete="email"
          className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          id="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
        {state.fieldErrors?.email ? (
          <p className="text-sm text-destructive" id="email-error">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>

      <Button className="h-11 w-full" disabled={pending} type="submit">
        {pending ? "正在发送…" : "发送 Magic Link"}
      </Button>

      {state.message ? (
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
