import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionView } from "../../shared/identity";
import { api, message } from "../api";

export function useSession() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setSession(null);
    setError("");
    try {
      const result = await api<{ session: SessionView }>("/api/session", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setSession(result.session);
    } catch (error) {
      if (!controller.signal.aborted) setError(message(error));
    }
  }, []);
  useEffect(() => {
    void reload();
    const changed = (event: MessageEvent) => {
      if (
        event.source === window.parent &&
        event.origin === window.location.origin &&
        event.data?.type === "rdfz:lesson-identity-changed"
      )
        void reload();
    };
    window.addEventListener("message", changed);
    return () => {
      current.current?.abort();
      window.removeEventListener("message", changed);
    };
  }, [reload]);
  return { session, error, reload };
}
