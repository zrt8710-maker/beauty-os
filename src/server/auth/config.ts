import { z } from "zod";

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().toLowerCase().email().optional(),
);

const authConfigSchema = z.object({
  allowedEmail: optionalEmail,
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

let cachedAuthConfig: AuthConfig | undefined;

export function getAuthConfig(): AuthConfig {
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  const result = authConfigSchema.safeParse({
    allowedEmail: process.env.AUTH_ALLOWED_EMAIL,
  });

  if (!result.success) {
    throw new Error(
      "AUTH_ALLOWED_EMAIL must be empty or contain one valid email address.",
    );
  }

  cachedAuthConfig = result.data;
  return cachedAuthConfig;
}

export function isEmailAllowed(
  email: string | undefined,
  allowedEmail: string | undefined,
): boolean {
  if (!allowedEmail) {
    return true;
  }

  return email?.trim().toLowerCase() === allowedEmail;
}
