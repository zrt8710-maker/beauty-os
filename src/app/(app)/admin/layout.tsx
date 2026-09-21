import type { ReactNode } from "react";

import { requireAdminPageAccess } from "@/server/admin/require-admin-page-access";

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireAdminPageAccess();
  return children;
}
