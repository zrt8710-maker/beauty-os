import { LoginForm } from "./login-form";
import { LoginScene } from "./login-scene";

const errorMessages: Record<string, string> = {
  invalid_code: "登录链接无效或已过期，请重新发送。",
  not_allowed: "该邮箱未获准使用此 Beauty OS 实例。",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <LoginScene>
      <section className="beauty-login-retreat" aria-labelledby="login-heading">
        <p className="beauty-login-wordmark">
          <span>Beauty OS</span>
        </p>
        <header className="beauty-login-intro">
          <p className="beauty-login-prelude"><span>留一点时间，照顾自己</span></p>
          <h1 id="login-heading" className="beauty-login-heading"><span>欢迎回来</span></h1>
          <p className="mt-4 text-sm leading-7 text-secondary-foreground">
            从今天的皮肤感受，继续你的护理日常。
          </p>
        </header>

        {error && errorMessages[error] ? (
          <p role="alert" className="mt-5 text-sm text-destructive">
            {errorMessages[error]}
          </p>
        ) : null}

        <div className="beauty-login-form-wrap mt-7">
          <LoginForm />
        </div>
        <p className="beauty-login-footnote">你的记录，你的节奏。</p>
      </section>
    </LoginScene>
  );
}

