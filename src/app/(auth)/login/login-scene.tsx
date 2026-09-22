import type { ReactNode } from "react";

export function LoginScene({ children }: { children: ReactNode }) {
  return (
    <main className="beauty-login-canvas relative flex min-h-svh items-center justify-center px-4 py-10 sm:px-6">
      {children}
    </main>
  );
}
