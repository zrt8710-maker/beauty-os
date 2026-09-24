import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/get-current-user";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? "/app" : "/login");
}
