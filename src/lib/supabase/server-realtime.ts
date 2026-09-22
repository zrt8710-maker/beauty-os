import type { SupabaseClientOptions } from "@supabase/supabase-js";
import WebSocket from "ws";

// EdgeOne runs server functions on Node 20, which has no native WebSocket.
type RealtimeTransport = NonNullable<
  SupabaseClientOptions<"public">["realtime"]
>["transport"];

export const serverRealtime = {
  transport: WebSocket as unknown as RealtimeTransport,
};
