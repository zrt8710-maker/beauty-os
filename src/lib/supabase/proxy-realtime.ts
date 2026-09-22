import type { SupabaseClientOptions } from "@supabase/supabase-js";

type RealtimeTransport = NonNullable<
  SupabaseClientOptions<"public">["realtime"]
>["transport"];

// Proxy only verifies auth claims and never opens a Realtime channel. Keeping
// this constructor dependency-free lets it run in EdgeOne's edge sandbox.
class UnusedProxyWebSocket {
  constructor() {
    throw new Error("Realtime is unavailable in the request proxy");
  }
}

export const proxyRealtime = {
  transport: UnusedProxyWebSocket as unknown as RealtimeTransport,
};
