import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { RemoteSummary } from "../api/types.js";

export function useRemotes() {
  const [remotes, setRemotes] = useState<RemoteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRemotes(await api.remotes());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { remotes, error, loading, refresh };
}
