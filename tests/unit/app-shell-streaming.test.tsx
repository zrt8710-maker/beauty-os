import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), weather: vi.fn() }));
vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/server/app-shell/app-shell-context", () => ({ getAppShellContext: mocks.weather }));
vi.mock("@/server/auth/sign-out", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import ProtectedAppLayout from "@/app/(app)/layout";

function findSuspense(node: ReactNode): ReactElement<{ children: ReactElement; fallback: ReactNode }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === Suspense) return child as ReactElement<{ children: ReactElement; fallback: ReactNode }>;
    const found = findSuspense(child.props.children);
    if (found) return found;
  }
}

describe("app shell streaming", () => {
  beforeEach(() => {
    mocks.user.mockReset();
    mocks.weather.mockReset();
  });

  it("returns the authenticated shell before weather and preserves the resolved weather values", async () => {
    mocks.user.mockResolvedValue({ id: "user-a", appRole: "user" });
    let resolveWeather!: (value: unknown) => void;
    mocks.weather.mockReturnValue(new Promise((resolve) => { resolveWeather = resolve; }));
    const shell = await ProtectedAppLayout({ children: <main>Page content</main> });
    expect(mocks.weather).not.toHaveBeenCalled();
    const boundary = findSuspense(shell);
    expect(boundary?.props.fallback).toBeTruthy();
    const weatherComponent = boundary!.props.children;
    const render = weatherComponent.type as (props: unknown) => Promise<ReactElement>;
    const weatherResult = render(weatherComponent.props);
    expect(mocks.weather).toHaveBeenCalledWith("user-a");
    resolveWeather({ profileRow: { location_name: "上海" }, weather: { humidity: 65, temperature: 26, uv_index: 4 } });
    expect((await weatherResult).props).toEqual({ locationLabel: "上海", humidity: 65, temperature: 26, uvIndex: 4 });
  });

  it("still redirects unauthenticated requests before rendering protected content", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(ProtectedAppLayout({ children: <main>Private</main> })).rejects.toThrow("redirect:/login");
    expect(mocks.weather).not.toHaveBeenCalled();
  });
});
