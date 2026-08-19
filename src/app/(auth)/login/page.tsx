import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/get-current-user";

import { LoginForm } from "./login-form";

const errorMessages: Record<string, string> = {
  invalid_code: "登录链接无效或已过期，请重新发送。",
  not_allowed: "该邮箱未获准使用此 Beauty OS 实例。",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/app");
  }

  const { error } = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-6 py-16">
      <section className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm sm:p-10">
        <p className="text-sm font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Beauty OS
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">登录</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          输入邮箱，我们会发送一次性登录链接，无需密码。
        </p>

        {error && errorMessages[error] ? (
          <p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessages[error]}
          </p>
        ) : null}

        <div className="mt-7">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
