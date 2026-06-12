import { Fragment, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Schedule, ScheduleInput } from "../api/types.js";
import { useRemotes } from "../hooks/useRemotes.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Daily 3am", value: "0 3 * * *" },
  { label: "Weekly (Sun 3am)", value: "0 3 * * 0" },
];

function emptyForm(remote: string): ScheduleInput {
  return {
    name: "", type: "copy", isDir: true,
    src: { remote, path: "", name: "" },
    dst: { remote, path: "", name: "" },
    cron: "0 3 * * *", enabled: true,
  };
}

function statusOf(s: Schedule): string {
  if (s.lastError) return `error: ${s.lastError}`;
  if (s.lastRun) return `last run ${s.lastRun}${s.lastJobId !== undefined ? ` (job ${s.lastJobId})` : ""}`;
  return "never run";
}

export function SchedulesPage() {
  const { remotes } = useRemotes();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleInput>(emptyForm(""));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);

  async function refresh() {
    try { setSchedules(await api.schedules()); setError(null); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!form.src.remote && remotes.length > 0) {
      setForm((f) => ({ ...f, src: { ...f.src, remote: remotes[0].name }, dst: { ...f.dst, remote: remotes[0].name } }));
    }
  }, [remotes, form.src.remote]);

  function set<K extends keyof ScheduleInput>(k: K, v: ScheduleInput[K]) { setForm((f) => ({ ...f, [k]: v })); }
  function setSrc(p: Partial<ScheduleInput["src"]>) { setForm((f) => ({ ...f, src: { ...f.src, ...p } })); }
  function setDst(p: Partial<ScheduleInput["dst"]>) { setForm((f) => ({ ...f, dst: { ...f.dst, ...p } })); }

  function startEdit(s: Schedule) {
    setEditingId(s.id);
    setForm({ name: s.name, type: s.type, isDir: s.isDir, src: { ...s.src }, dst: { ...s.dst }, cron: s.cron, enabled: s.enabled });
  }
  function resetForm() { setEditingId(null); setForm(emptyForm(remotes[0]?.name ?? "")); }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editingId) await api.updateSchedule(editingId, form);
      else await api.createSchedule(form);
      resetForm();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(id: string) {
    try { await api.runSchedule(id); } catch (e) { setError((e as Error).message); }
    await refresh();
  }
  async function toggle(s: Schedule) {
    try { await api.updateSchedule(s.id, { enabled: !s.enabled }); } catch (e) { setError((e as Error).message); }
    await refresh();
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    try { await api.deleteSchedule(pendingDelete); } catch (e) { setError((e as Error).message); }
    setPendingDelete(null);
    await refresh();
  }

  const remoteOptions = remotes.map((r) => <option key={r.name} value={r.name}>{r.name}</option>);

  return (
    <div>
      <h2>Schedules</h2>
      <p className="hint">Run a copy/move on a cron schedule. Times use the server's timezone. Missed runs while the server is down are not back-filled.</p>
      {error ? <p className="error-text">{error}</p> : null}

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <h3>{editingId ? "Edit schedule" : "New schedule"}</h3>
        <div className="field">
          <label htmlFor="sch-name">Name</label>
          <input id="sch-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="toolbar">
          <select aria-label="Type" value={form.type} onChange={(e) => set("type", e.target.value as "copy" | "move")}>
            <option value="copy">copy</option><option value="move">move</option>
          </select>
          <label><input type="checkbox" checked={form.isDir} onChange={(e) => set("isDir", e.target.checked)} /> directory</label>
        </div>
        <div className="toolbar">
          <span>From:</span>
          <select aria-label="Source remote" value={form.src.remote} onChange={(e) => setSrc({ remote: e.target.value })}>{remoteOptions}</select>
          <input aria-label="Source path" placeholder="src path" value={form.src.path} onChange={(e) => setSrc({ path: e.target.value })} />
          <input aria-label="Source name" placeholder="name (blank = whole dir)" value={form.src.name} onChange={(e) => setSrc({ name: e.target.value })} />
        </div>
        <div className="toolbar">
          <span>To:</span>
          <select aria-label="Dest remote" value={form.dst.remote} onChange={(e) => setDst({ remote: e.target.value })}>{remoteOptions}</select>
          <input aria-label="Dest path" placeholder="dst path" value={form.dst.path} onChange={(e) => setDst({ path: e.target.value })} />
          <input aria-label="Dest name" placeholder="name" value={form.dst.name} onChange={(e) => setDst({ name: e.target.value })} />
        </div>
        <div className="toolbar">
          <label htmlFor="sch-cron">Cron</label>
          <input id="sch-cron" value={form.cron} onChange={(e) => set("cron", e.target.value)} />
          {CRON_PRESETS.map((p) => <button key={p.value} type="button" className="btn secondary" onClick={() => set("cron", p.value)}>{p.label}</button>)}
          <label><input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> enabled</label>
        </div>
        <div className="toolbar">
          <button className="btn" disabled={busy || !form.name || !form.src.remote} onClick={save}>{busy ? "Saving…" : editingId ? "Update" : "Create"}</button>
          {editingId ? <button className="btn secondary" onClick={resetForm}>Cancel</button> : null}
        </div>
      </div>

      <table className="table">
        <thead><tr><th>Name</th><th>Transfer</th><th>Cron</th><th>Enabled</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {schedules.map((s) => (
            <Fragment key={s.id}>
              <tr>
                <td>{s.name}</td>
                <td className="hint">{s.type} {s.src.remote}:{s.src.path}/{s.src.name} → {s.dst.remote}:{s.dst.path}</td>
                <td><code>{s.cron}</code></td>
                <td><button className="btn secondary" onClick={() => toggle(s)}>{s.enabled ? "on" : "off"}</button></td>
                <td className="hint">{statusOf(s)}</td>
                <td>
                  <button className="btn secondary" onClick={() => run(s.id)}>Run now</button>{" "}
                  <button className="btn secondary" onClick={() => startEdit(s)}>Edit</button>{" "}
                  <button className="btn secondary" onClick={() => setPendingDelete(s.id)}>Delete</button>{" "}
                  <button className="btn secondary" onClick={() => setHistoryId(historyId === s.id ? null : s.id)}>History</button>{" "}
                </td>
              </tr>
              {historyId === s.id ? (
                <tr>
                  <td colSpan={6}>
                    {(s.history ?? []).length === 0 ? (
                      <span className="hint">No runs recorded.</span>
                    ) : (
                      <ul style={{ margin: 0 }}>
                        {(s.history ?? []).map((r, i) => (
                          <li key={i} className="hint">
                            {r.time} — {r.error ? `error: ${r.error}` : r.jobId !== undefined ? `job ${r.jobId}` : "ok"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
          {schedules.length === 0 ? <tr><td colSpan={6} className="hint">No schedules yet.</td></tr> : null}
        </tbody>
      </table>

      {pendingDelete ? (
        <ConfirmDialog message="Delete this schedule?" onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />
      ) : null}
    </div>
  );
}
