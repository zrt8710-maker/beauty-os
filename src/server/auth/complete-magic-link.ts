import { isEmailAllowed } from "@/server/auth/config";

type Claims = {
  sub?: unknown;
  email?: unknown;
};

type MagicLinkClient = {
  auth: {
    exchangeCodeForSession: (
      code: string,
    ) => Promise<{ error: { message: string } | null }>;
    getClaims: () => Promise<{
      data: { claims: Claims } | null;
      error: { message: string } | null;
    }>;
    signOut: () => Promise<unknown>;
  };
};

export type CompleteMagicLinkResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_code" | "not_allowed" };

export async function completeMagicLink(
  client: MagicLinkClient,
  code: string,
  allowedEmail?: string,
): Promise<CompleteMagicLinkResult> {
  const { error: exchangeError } =
    await client.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return { ok: false, reason: "invalid_code" };
  }

  const { data, error: claimsError } = await client.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : undefined;

  if (claimsError || typeof claims?.sub !== "string") {
    await client.auth.signOut();
    return { ok: false, reason: "invalid_code" };
  }

  if (!isEmailAllowed(email, allowedEmail)) {
    await client.auth.signOut();
    return { ok: false, reason: "not_allowed" };
  }

  return { ok: true, userId: claims.sub };
}
