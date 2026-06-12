import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { MountInstance } from "../api/types.js";
import { useRemotes } from "../hooks/useRemotes.js";

export function MountsPage() {
  const { remotes } = useRemotes();
  const [types, setTypes] = useState<string[]>([]);
  const [mounts, setMounts] = useState<MountInstance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState("");
  const [path, setPath] = useState("");
  const [mountPoint, setMountPoint] = useState("");
  const [mountType, setMountType] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setMounts(await api.mounts()); setError(null); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    api.mountTypes().then(setTypes).catch((e: Error) => setError(e.message));
    void refresh();
  }, []);
  useEffect(() => { if (!remote && remotes.length > 0) setRemote(remotes[0].name); }, [remotes, remote]);

  async function doMount() {
    setBusy(true);
    setError(null);
    try {
      await api.mount({ remote, path, mountPoint, mountType: mountType || undefined });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doUnmount(mp: string) {
    try { await api.unmount(mp); } catch (e) { setError((e as Error).message); }
    await refresh();
  }

  return (
    <div>
      <h2>Mounts</h2>
      <div className="banner" role="note">
        ⓘ Mounting needs FUSE. In Docker, run the container with <code>--cap-add SYS_ADMIN --device /dev/fuse</code>
        (and a bind-mounted target with shared propagation) or mount calls will fail.
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      <div className="toolbar">
        <select aria-label="Remote" value={remote} onChange={(e) => setRemote(e.target.value)}>
          {remotes.length === 0 ? <option value="">(no remotes)</option> : null}
          {remotes.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
        <input aria-label="Path" placeholder="path (optional)" value={path} onChange={(e) => setPath(e.target.value)} />
        <input aria-label="Mount point" placeholder="/mnt/point" value={mountPoint} onChange={(e) => setMountPoint(e.target.value)} />
        <select aria-label="Mount type" value={mountType} onChange={(e) => setMountType(e.target.value)}>
          <option value="">(auto)</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn" disabled={busy || !remote || !mountPoint} onClick={doMount}>{busy ? "Mounting…" : "Mount"}</button>
      </div>

      <table className="table">
        <thead><tr><th>Remote</th><th>Mount point</th><th></th></tr></thead>
        <tbody>
          {mounts.map((m) => (
            <tr key={m.mountPoint}>
              <td>{m.fs}</td>
              <td>{m.mountPoint}</td>
              <td><button className="btn secondary" onClick={() => doUnmount(m.mountPoint)}>Unmount</button></td>
            </tr>
          ))}
          {mounts.length === 0 ? <tr><td colSpan={3} className="hint">No active mounts.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
