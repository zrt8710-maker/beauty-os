import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email();
const tokenSchema = z.string().trim().regex(/^\d{6}$/u);

export type EmailOtpActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  email?: string;
  cooldownUntil?: number;
  redirectTo?: "/app" | "/profile";
  fieldErrors?: { email?: string[]; token?: string[] };
};

type AuthResult = Promise<{
  error: {
    message: string;
    code?: string;
    status?: number;
  } | null;
}>;

export async function requestEmailOtp(
  input: { email: unknown; allowedEmail?: string },
  send: (email: string) => AuthResult,
): Promise<EmailOtpActionState> {
  const parsedEmail = emailSchema.safeParse(input.email);
  if (!parsedEmail.success) {
    return { status: "error", message: "请输入有效的邮箱地址。", fieldErrors: { email: ["请输入有效的邮箱地址。"] } };
  }
  if (!emailIsAllowed(parsedEmail.data, input.allowedEmail)) {
    return { status: "error", message: "该邮箱未获准使用此 Beauty OS 实例。" };
  }
  const { error } = await send(parsedEmail.data);
  if (
    error?.status === 429 ||
    error?.code === "over_email_send_rate_limit"
  ) {
    return { status: "error", message: "发送过于频繁，请稍后再试。" };
  }
  return error
    ? { status: "error", message: "验证码发送失败，请稍后重试。" }
    : { status: "success", message: "验证码已发送至你的邮箱。" };
}

export async function verifyEmailOtpCode(
  input: { email: unknown; token: unknown; allowedEmail?: string },
  verify: (email: string, token: string) => AuthResult,
): Promise<EmailOtpActionState> {
  const parsedEmail = emailSchema.safeParse(input.email);
  const parsedToken = tokenSchema.safeParse(input.token);
  if (!parsedEmail.success) {
    return { status: "error", message: "请输入有效的邮箱地址。", fieldErrors: { email: ["请输入有效的邮箱地址。"] } };
  }
  if (!emailIsAllowed(parsedEmail.data, input.allowedEmail)) {
    return { status: "error", message: "该邮箱未获准使用此 Beauty OS 实例。" };
  }
  if (!parsedToken.success) {
    return { status: "error", message: "请输入邮件中的 6 位验证码。", fieldErrors: { token: ["请输入邮件中的 6 位验证码。"] } };
  }
  const { error } = await verify(parsedEmail.data, parsedToken.data);
  if (error?.code === "network_error") {
    return { status: "error", message: "网络连接失败，请稍后重试。" };
  }
  return error
    ? { status: "error", message: "验证码错误或已过期，请重新输入或获取新验证码。" }
    : { status: "success", message: "登录成功，正在进入 Beauty OS…" };
}

function emailIsAllowed(email: string, allowedEmail: string | undefined) {
  return !allowedEmail || email === allowedEmail.trim().toLowerCase();
}
