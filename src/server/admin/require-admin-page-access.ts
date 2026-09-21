import "server-only";

import { notFound, redirect } from "next/navigation";

import {
  AdminRequiredError,
  UnauthorizedError,
  requireAdmin,
  type AdminContext,
} from "@/server/auth/require-admin";

export async function requireAdminPageAccess(): Promise<AdminContext> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }

    if (error instanceof AdminRequiredError) {
      notFound();
    }

    throw error;
  }
}
