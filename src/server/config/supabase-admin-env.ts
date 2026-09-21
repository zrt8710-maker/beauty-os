import "server-only";

import { z } from "zod";

const supabaseAdminEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
});

export type SupabaseAdminEnv = z.infer<typeof supabaseAdminEnvSchema>;

export class SupabaseAdminConfigurationError extends Error {
  readonly code = "SUPABASE_ADMIN_CONFIGURATION_ERROR";

  constructor(public readonly invalidVariables: string[]) {
    super(
      `Missing or invalid server environment variables: ${invalidVariables.join(", ")}. Configure the server-only Supabase admin credentials.`,
    );
    this.name = "SupabaseAdminConfigurationError";
  }
}

export function getSupabaseAdminEnv(): SupabaseAdminEnv {
  const result = supabaseAdminEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!result.success) {
    const invalidVariables = [
      ...new Set(
        result.error.issues.map((issue) =>
          String(issue.path[0] ?? "SUPABASE_ADMIN_ENV")),
      ),
    ];
    throw new SupabaseAdminConfigurationError(invalidVariables);
  }

  return result.data;
}
