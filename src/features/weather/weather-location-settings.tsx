"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { searchCitiesFromBrowser, type LocationCandidate } from "./open-meteo-browser-search";

export function WeatherLocationSettings({
  initialLocationName,
  onSaved,
  presentation = "card",
}: {
  initialLocationName: string | null;
  onSaved?: () => void;
  presentation?: "card" | "embedded";
}) {
  const router = useRouter();
  const [locationName, setLocationName] = useState(initialLocationName);
  const [editing, setEditing] = useState(!initialLocationName);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function search() {
    const value = query.trim();
    if (!value) return;
    setBusy(true);
    setMessage("");
    setCandidates([]);
    try {
      const response = await fetch(`/api/v1/weather/locations?query=${encodeURIComponent(value)}`);
      const data = response.status === 502
        ? await searchCitiesFromBrowser(value)
        : readCandidates(await response.json());
      if ((response.status !== 502 && !response.ok) || !data) throw new Error();
      setCandidates(data);
      if (data.length === 0) setMessage("没有找到这个城市，可以换个名称试试。");
    } catch {
      setMessage("暂时无法搜索城市，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function select(candidate: LocationCandidate) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/weather/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      if (response.ok || response.status === 502) {
        setLocationName(candidate.displayName);
        setCandidates([]);
        setQuery("");
        setEditing(false);
        setMessage(response.ok ? "城市与今日环境已更新。" : "城市已保存，今日环境暂时无法更新，可稍后重试。");
        router.refresh();
        onSaved?.();
        return;
      }
      setMessage("城市保存失败，请重新选择搜索结果后重试。");
    } catch {
      setMessage("城市保存状态暂时无法确认，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={presentation === "card" ? "rounded-2xl border border-border/70 bg-card p-6 shadow-[var(--shadow-card)]" : ""}>
      <p className="text-sm font-semibold text-info">环境设置</p>
      <h2 className="mt-1 text-xl font-semibold">所在城市</h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm">当前城市：{locationName ?? "未设置"}</p>
        <Button disabled={busy} onClick={() => { setEditing((value) => !value); setMessage(""); setCandidates([]); }} size="sm" type="button" variant="outline">
          {editing && locationName ? "取消修改" : locationName ? "修改城市" : "选择城市"}
        </Button>
      </div>
      {editing ? (
        <div className="mt-4 max-w-md">
          <div className="flex gap-2">
            <input aria-label="搜索所在城市" className="h-9 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="输入城市名称，例如成都" value={query} />
            <Button disabled={busy || !query.trim()} onClick={() => void search()} size="sm" type="button">{busy ? "处理中…" : "搜索"}</Button>
          </div>
          {candidates.length > 0 ? (
            <ul className="mt-2 overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card-hover)]">
              {candidates.map((candidate) => (
                <li key={`${candidate.displayName}-${candidate.latitude}-${candidate.longitude}`}>
                  <button className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-selected disabled:opacity-50" disabled={busy} onClick={() => void select(candidate)} type="button">
                    {candidate.displayName}{candidate.region ? ` · ${candidate.region}` : ""}{candidate.country ? ` · ${candidate.country}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}

function readCandidates(value: unknown): LocationCandidate[] | null {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) return null;
  return value.data.every((candidate) => candidate && typeof candidate === "object" && "displayName" in candidate && "latitude" in candidate && "longitude" in candidate && "timezone" in candidate)
    ? value.data as LocationCandidate[]
    : null;
}
