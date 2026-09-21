import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workspace = process.cwd();
const adminClientPath = path.join(
  workspace,
  "src/lib/supabase/admin.ts",
);
const adminEnvPath = path.join(
  workspace,
  "src/server/config/supabase-admin-env.ts",
);

describe("Supabase admin server-only boundary", () => {
  it("marks both privileged modules as server-only", async () => {
    const [clientSource, envSource] = await Promise.all([
      readFile(adminClientPath, "utf8"),
      readFile(adminEnvPath, "utf8"),
    ]);

    expect(clientSource.trimStart()).toMatch(/^import "server-only";/);
    expect(envSource.trimStart()).toMatch(/^import "server-only";/);
  });

  it("does not use cookies, sessions, or a browser Supabase client", async () => {
    const source = await readFile(adminClientPath, "utf8");

    expect(source).not.toContain("next/headers");
    expect(source).not.toContain("@supabase/ssr");
    expect(source).not.toContain("createBrowserClient");
    expect(source).not.toContain("createServerClient");
  });

  it("keeps public service-role variables and admin imports out of client source", async () => {
    const sourceFiles = await listSourceFiles(path.join(workspace, "src"));

    for (const file of sourceFiles) {
      const source = await readFile(file, "utf8");
      expect(source).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");

      if (/^[\s\r\n]*["']use client["'];/.test(source)) {
        expect(source).not.toContain("@/lib/supabase/admin");
        expect(source).not.toContain(
          "@/server/config/supabase-admin-env",
        );
      }
    }
  });
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  }));
  return files.flat();
}
