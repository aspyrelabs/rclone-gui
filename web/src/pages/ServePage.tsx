import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { ServeInstance } from "../api/types.js";
import { useRemotes } from "../hooks/useRemotes.js";

const HTTP_LIKE = new Set(["http", "webdav"]);

export function ServePage() {
  const { remotes } = useRemotes();
  const [types, setTypes] = useState<string[]>([]);
  const [serves, setServes] = useState<ServeInstance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("http");
  const [remote, setRemote] = useState("");
  const [path, setPath] = useState("");
  const [addr, setAddr] = useState("0.0.0.0:8080");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setServes(await api.serves());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    api.serveTypes().then(setTypes).catch((e: Error) => setError(e.message));
    void refresh();
  }, []);
  useEffect(() => { if (!remote && remotes.length > 0) setRemote(remotes[0].name); }, [remotes, remote]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api.startServe({ type, remote, path, addr: addr || undefined });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    try { await api.stopServe(id); } catch (e) { setError((e as Error).message); }
    await refresh();
  }

  return (
    <div>
      <h2>Serve</h2>
      <p className="hint">Expose a remote over a network protocol. The served address is reachable on the container's network — map/publish the port to use it from outside.</p>
      {error ? <p className="error-text">{error}</p> : null}

      <div className="toolbar">
        <select aria-label="Serve type" value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Remote" value={remote} onChange={(e) => setRemote(e.target.value)}>
          {remotes.length === 0 ? <option value="">(no remotes)</option> : null}
          {remotes.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
        <input aria-label="Path" placeholder="path (optional)" value={path} onChange={(e) => setPath(e.target.value)} />
        <input aria-label="Address" placeholder="addr e.g. 0.0.0.0:8080" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <button className="btn" disabled={busy || !remote} onClick={start}>{busy ? "Starting…" : "Start serve"}</button>
      </div>

      <table className="table">
        <thead><tr><th>Type</th><th>Address</th><th>Remote</th><th></th></tr></thead>
        <tbody>
          {serves.map((s) => (
            <tr key={s.id}>
              <td>{s.type}</td>
              <td>{HTTP_LIKE.has(s.type) ? <a href={`http://${s.addr}`} target="_blank" rel="noreferrer">{s.addr}</a> : s.addr}</td>
              <td>{s.fs}</td>
              <td><button className="btn secondary" onClick={() => stop(s.id)}>Stop</button></td>
            </tr>
          ))}
          {serves.length === 0 ? <tr><td colSpan={4} className="hint">No active serves.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
