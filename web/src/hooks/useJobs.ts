import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { JobInfo } from "../api/types.js";

/** Poll the jobs list while mounted (default every 1.5s). */
export function useJobs(intervalMs = 1500) {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await api.listJobs());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { jobs, error, refresh };
}
