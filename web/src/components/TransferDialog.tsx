import { useState } from "react";
import { api } from "../api/client.js";
import type { PathRef } from "../api/types.js";

export function TransferDialog({
  type,
  src,
  isDir,
  remotes,
  onClose,
  onLaunched,
}: {
  type: "copy" | "move";
  src: PathRef;
  isDir: boolean;
  remotes: string[];
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [destRemote, setDestRemote] = useState(src.remote);
  const [destPath, setDestPath] = useState(src.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      await api.launchJob({
        type,
        isDir,
        src,
        dst: { remote: destRemote, path: destPath, name: src.name },
      });
      onLaunched();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{type === "copy" ? "Copy" : "Move"} "{src.name || `${src.remote}:${src.path}`}"</h2>
        <div className="field">
          <label htmlFor="dest-remote">Destination remote</label>
          <select id="dest-remote" value={destRemote} onChange={(e) => setDestRemote(e.target.value)}>
            {remotes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dest-path">Destination folder (path within the remote)</label>
          <input id="dest-path" value={destPath} onChange={(e) => setDestPath(e.target.value)} placeholder="(root)" />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={launch}>{busy ? "Starting…" : `Start ${type}`}</button>
        </div>
      </div>
    </div>
  );
}
