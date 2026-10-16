"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the open page current: every write to the organization (by anyone, from any tab) pings the private Realtime
 * channel "org:<id>" (trigger on audit_log, migration 0009), and the page re-fetches its Server Components in place
 * with router.refresh(): tables, KPIs and charts update without a reload and without losing scroll or form state.
 * The ping carries no data; what the page shows still comes from the RLS-checked server path.
 * A hidden tab only remembers that something changed and refreshes when it becomes visible again.
 */
export function LiveUpdates({ orgId }: { orgId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stale = false;
    // One write can produce several pings (one per audited row): wait for the burst to end.
    const refresh = () => {
      if (document.visibilityState === "hidden") return void (stale = true);
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && stale) {
        stale = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    // Private channels authorize with the user's access token (RLS on realtime.messages).
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`org:${orgId}`, { config: { private: true } })
        .on("broadcast", { event: "change" }, refresh)
        .subscribe((status) => {
          document.documentElement.dataset.live = status === "SUBSCRIBED" ? "on" : "off"; // read by the e2e tests
        });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [orgId, router]);
  return null;
}
