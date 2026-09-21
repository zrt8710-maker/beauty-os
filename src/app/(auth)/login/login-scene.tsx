"use client";

import { useEffect, useRef, type ReactNode, type PointerEvent } from "react";

export function LoginScene({ children }: { children: ReactNode }) {
  const scene = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);

  function reset() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    for (const element of Array.from(scene.current?.querySelectorAll<HTMLElement>("[data-login-depth]") ?? [])) {
      if (element) element.style.transform = "translate3d(0, 0, 0)";
    }
  }

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce), (hover: none), (pointer: coarse)");
    media.addEventListener("change", reset);
    window.addEventListener("blur", reset);
    return () => {
      media.removeEventListener("change", reset);
      window.removeEventListener("blur", reset);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  function followPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (scene.current?.querySelector("form:focus-within")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      scene.current?.querySelectorAll<HTMLElement>("[data-login-depth]").forEach((element) => {
        const depth = Number(element.dataset.loginDepth);
        element.style.transform = `translate3d(${x * depth}px, ${y * depth * .5}px, 0)`;
      });
    });
  }

  return (
    <main ref={scene} className="beauty-login-canvas relative flex min-h-svh items-center justify-center px-4 py-10 sm:px-6" onPointerMove={followPointer} onPointerLeave={reset} onFocusCapture={reset}>
      {children}
    </main>
  );
}
