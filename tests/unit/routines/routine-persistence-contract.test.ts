import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EXCLUSION_REASON_CODES,
  ROUTINE_REASON_CODES,
} from "@/schemas/routine";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260905000000_repair_routine_persistence_contract.sql",
    import.meta.url,
  )),
  "utf8",
);
const decisionSnapshotMigration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260906000000_add_routine_decision_snapshot.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("routine persistence contract", () => {
  it("allows every schema step reason code in the routine_steps constraint", () => {
    for (const code of ROUTINE_REASON_CODES) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it("allows every schema exclusion reason code in replace_daily_routine", () => {
    for (const code of EXCLUSION_REASON_CODES) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it("retains the authenticated ownership checks while replacing the RPC", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("ROUTINE_EXCLUDES_UNOWNED_PRODUCT");
    expect(migration).toContain("ROUTINE_CONTAINS_UNOWNED_PRODUCT");
  });

  it("adds one nullable decision snapshot and writes it through the existing RPC", () => {
    expect(decisionSnapshotMigration).toContain("add column decision_snapshot jsonb null");
    expect(decisionSnapshotMigration).toContain("p_decision_snapshot jsonb");
    expect(decisionSnapshotMigration).toContain("decision_snapshot = excluded.decision_snapshot");
    expect(decisionSnapshotMigration).toContain("drop function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb)");
  });
});
