export type AuthConfig = { allowedEmail?: string };

export function getAuthConfig(): AuthConfig {
  // Public registration: deliberately ignore the retired AUTH_ALLOWED_EMAIL
  // variable, including stale values in existing deployment environments.
  return { allowedEmail: undefined };
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
