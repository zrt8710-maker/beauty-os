"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { useBeautyDialog } from "@/components/use-beauty-dialog";
import { WeatherLocationSettings } from "@/features/weather/weather-location-settings";

export function SidebarEnvironmentEntry({
  humidity,
  locationLabel,
  temperature,
  uvIndex,
}: {
  humidity: number | null;
  locationLabel: string | null;
  temperature: number | null;
  uvIndex: number | null;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useBeautyDialog(open, () => setOpen(false));
  const details = humidity === null && uvIndex === null
    ? "今日天气暂未更新"
    : [
        humidity === null ? null : `湿度 ${humidity}%`,
        uvIndex === null ? null : `UV ${uvIndex}`,
      ].filter(Boolean).join(" · ");

  return (
    <>
      <button
        aria-label="环境与城市设置"
        className="w-full rounded-xl px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          <BeautyNavIcon name="weather" size={16} />
          {locationLabel ?? "所在城市"}
          {!locationLabel ? <span aria-label="待设置城市" className="inline-flex size-4 items-center justify-center rounded-full bg-warning/15 text-[11px] font-bold text-warning">!</span> : null}
          {temperature === null ? "" : ` · ${temperature}°C`}
        </span>
        <span className="mt-1 block">{details}</span>
      </button>

      {open ? createPortal(
        <div className="beauty-overlay z-[80]">
          <button
            aria-label="关闭环境设置"
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setOpen(false)}
            type="button"
          />
          <section
            aria-labelledby="environment-sheet-title"
            aria-modal="true"
            className="beauty-sheet relative z-10 sm:max-w-lg"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div aria-hidden="true" className="beauty-sheet-handle" />
            <div className="beauty-sheet-header flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-info">全局环境</p>
                <h2 className="text-xl font-semibold" id="environment-sheet-title">天气与城市</h2>
              </div>
              <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">关闭</Button>
            </div>
            <div className="beauty-sheet-content pt-2">
              <WeatherLocationSettings
                initialLocationName={locationLabel}
                onSaved={() => setOpen(false)}
                presentation="embedded"
              />
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
