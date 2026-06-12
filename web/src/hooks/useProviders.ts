import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { RcProvider } from "../api/types.js";

export function useProviders() {
  const [providers, setProviders] = useState<RcProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .providers()
      .then((p) => { if (alive) setProviders(p); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  return { providers, error, loading: providers === null && error === null };
}
