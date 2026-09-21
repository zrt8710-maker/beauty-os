import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("long-term skin baseline migration", () => {
  it("adds a backwards-compatible JSONB default to profiles", () => {
    const sql = readFileSync("supabase/migrations/20260831000000_add_long_term_skin_baseline.sql", "utf8");
    expect(sql).toContain("long_term_skin_baseline jsonb not null default '{}'::jsonb");
    expect(sql).toContain("jsonb_typeof(long_term_skin_baseline) = 'object'");
  });
});
