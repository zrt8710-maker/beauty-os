import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email();

export type LoginActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: {
    email?: string[];
  };
};

type MagicLinkSender = (input: {
  email: string;
  redirectTo: string;
}) => Promise<{
  error: {
    message: string;
    code?: string;
    status?: number;
  } | null;
}>;

export async function requestMagicLink(
  input: {
    email: unknown;
    redirectTo: string;
    allowedEmail?: string;
  },
  send: MagicLinkSender,
): Promise<LoginActionState> {
  const parsedEmail = emailSchema.safeParse(input.email);

  if (!parsedEmail.success) {
    return {
      status: "error",
      fieldErrors: { email: ["请输入有效的邮箱地址。"] },
    };
  }

  if (
    input.allowedEmail &&
    parsedEmail.data !== input.allowedEmail.trim().toLowerCase()
  ) {
    return {
      status: "error",
      message: "该邮箱未获准使用此 Beauty OS 实例。",
    };
  }

  const { error } = await send({
    email: parsedEmail.data,
    redirectTo: input.redirectTo,
  });

  if (error) {
    if (
      error.status === 429 ||
      error.code === "over_email_send_rate_limit"
    ) {
      return {
        status: "error",
        message: "发送过于频繁，请稍后再试。",
      };
    }

    return {
      status: "error",
      message: "登录邮件发送失败，请稍后重试。",
    };
  }

  return {
    status: "success",
    message: "登录链接已发送，请检查你的邮箱。",
  };
}
