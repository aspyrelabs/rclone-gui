import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client.js";
import type { AuthStatus } from "../api/types.js";

export function AuthGate({ children }: { children: (status: AuthStatus) => ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.authStatus().then(setStatus).catch((e: Error) => setError(e.message));
  useEffect(() => { void refresh(); }, []);

  if (error) return <div className="content"><p className="error-text">{error}</p></div>;
  if (!status) return <div className="content">Loading…</div>;

  if (status.protected && !status.authenticated) {
    return (
      <div className="content">
        <h2>Sign in</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.login(password);
              await refresh();
              setError(null);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn" type="submit">Log in</button>
        </form>
      </div>
    );
  }

  return <>{children(status)}</>;
}
