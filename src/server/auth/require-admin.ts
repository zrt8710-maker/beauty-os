import "server-only";

import {
  getCurrentUser,
  type CurrentUser,
} from "@/server/auth/get-current-user";

export type AdminContext = CurrentUser & { appRole: "admin" };

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
  readonly status = 401;

  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class AdminRequiredError extends Error {
  readonly code = "ADMIN_REQUIRED";
  readonly status = 403;

  constructor() {
    super("ADMIN_REQUIRED");
    this.name = "AdminRequiredError";
  }
}

export async function requireAdmin(): Promise<AdminContext> {
  const user = await getCurrentUser();

  if (!user) {
    throw new UnauthorizedError();
  }

  if (user.appRole !== "admin") {
    throw new AdminRequiredError();
  }

  return user as AdminContext;
}
