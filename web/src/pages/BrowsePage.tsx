import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { DirEntry } from "../api/types.js";
import { useRemotes } from "../hooks/useRemotes.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { TransferDialog } from "../components/TransferDialog.js";

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function BrowsePage() {
  const { remotes } = useRemotes();
  const [remote, setRemote] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DirEntry | null>(null);
  const [transfer, setTransfer] = useState<{ entry: DirEntry; type: "copy" | "move" } | null>(null);

  useEffect(() => {
    if (!remote && remotes.length > 0) setRemote(remotes[0].name);
  }, [remotes, remote]);

  async function load(): Promise<void> {
    if (!remote) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.browse(remote, path));
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let current = true;
    if (!remote) return;
    setLoading(true);
    setError(null);
    api.browse(remote, path)
      .then((entries) => { if (current) { setEntries(entries); } })
      .catch((e: Error) => { if (current) { setError(e.message); setEntries([]); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [remote, path]);

  const crumbs = path ? path.split("/") : [];

  async function newFolder() {
    const name = window.prompt("New folder name");
    if (!name) return;
    try {
      await api.mkdir(remote, path, name);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.deletePath(remote, path, pendingDelete.Name, pendingDelete.IsDir);
    } catch (e) {
      setError((e as Error).message);
      return; // keep the dialog open on failure
    }
    setPendingDelete(null);
    await load();
  }

  return (
    <div>
      <h2>Browse</h2>
      <div className="toolbar">
        <label htmlFor="remote-select">Remote:</label>
        <select id="remote-select" value={remote} onChange={(e) => { setRemote(e.target.value); setPath(""); }}>
          {remotes.length === 0 ? <option value="">(no remotes)</option> : null}
          {remotes.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
        <button className="btn secondary" onClick={newFolder} disabled={!remote}>New folder</button>
      </div>

      <div className="breadcrumb">
        <button type="button" className="linkbtn" onClick={() => setPath("")}>{remote || "—"}:</button>
        {crumbs.map((seg, i) => (
          <span key={i}> / <button type="button" className="linkbtn" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>{seg}</button></span>
        ))}
      </div>

      {loading ? <p>Loading…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <table className="table">
        <thead><tr><th>Name</th><th>Size</th><th>Actions</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.Path} className={e.IsDir ? "row-dir" : ""}>
              <td>
                {e.IsDir ? (
                  <span className="name" onClick={() => setPath(joinPath(path, e.Name))}>📁 {e.Name}</span>
                ) : (
                  <span>📄 {e.Name}</span>
                )}
              </td>
              <td>{e.IsDir ? "—" : `${e.Size}`}</td>
              <td>
                <button className="btn secondary" onClick={() => setTransfer({ entry: e, type: "copy" })}>Copy</button>{" "}
                <button className="btn secondary" onClick={() => setTransfer({ entry: e, type: "move" })}>Move</button>{" "}
                <button className="btn secondary" onClick={() => setPendingDelete(e)}>Delete</button>
              </td>
            </tr>
          ))}
          {!loading && entries.length === 0 && remote ? (
            <tr><td colSpan={3} className="hint">Empty.</td></tr>
          ) : null}
        </tbody>
      </table>

      {pendingDelete ? (
        <ConfirmDialog
          message={`Delete "${pendingDelete.Name}"${pendingDelete.IsDir ? " and everything in it" : ""}? This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

      {transfer ? (
        <TransferDialog
          type={transfer.type}
          src={{ remote, path, name: transfer.entry.Name }}
          isDir={transfer.entry.IsDir}
          remotes={remotes.map((r) => r.name)}
          onClose={() => setTransfer(null)}
          onLaunched={() => setTransfer(null)}
        />
      ) : null}
    </div>
  );
}
