# rclone GUI — Stage 4 Plan B: Frontend (Schedules UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Schedules page to create/edit/delete cron schedules, toggle them, run-now, and see last-run status — plus enabling the last "soon" nav item.

**Architecture:** API client methods + types over the Stage 4 endpoints, one new page, routing/sidebar update. Minimal CSS (reuse existing classes).

**Tech Stack:** unchanged (React 18, Vite, TS ESM, Vitest + RTL + user-event; mocked API in tests).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-4-design.md`
**Builds on:** Stages 1–3 frontend + Stage 4 backend (merged). Backend contract:
- `GET /api/schedules` → `{schedules: Schedule[]}`; `POST /api/schedules {ScheduleInput}` → 201 `{schedule}` (400 invalid); `PUT /api/schedules/:id {partial}` → `{schedule}` (404 unknown); `DELETE /api/schedules/:id` → `{deleted}` (404); `POST /api/schedules/:id/run` → `{ran}`.
- `Schedule = {id,name,type,isDir,src:PathRef,dst:PathRef,cron,enabled,lastRun?,lastJobId?,lastError?}`; `PathRef={remote,path,name}`.

Existing reusable: `api`/`ApiError`, `useRemotes()`, `ConfirmDialog`, `AppShell` (SOON currently `["Schedules"]`), `App.tsx`. CSS `.table/.toolbar/.field/.btn/.error-text/.hint/.banner` exist.

---

## File structure introduced/changed

```
web/src/
  api/types.ts            # + SchedulePathRef, Schedule, ScheduleInput
  api/client.ts           # + schedules/createSchedule/updateSchedule/deleteSchedule/runSchedule
  pages/SchedulesPage.tsx  # NEW
  components/AppShell.tsx  # Schedules becomes a real link (SOON now empty)
  App.tsx                  # + /schedules route
```

---

## Task 1: API client + types

**Files:** Modify `web/src/api/types.ts`, `web/src/api/client.ts`; create `web/src/api/schedules.test.ts`.

- [ ] **Step 1: Append to `web/src/api/types.ts`**

```ts
export interface SchedulePathRef {
  remote: string;
  path: string;
  name: string;
}

export interface Schedule {
  id: string;
  name: string;
  type: "copy" | "move";
  isDir: boolean;
  src: SchedulePathRef;
  dst: SchedulePathRef;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  lastJobId?: number;
  lastError?: string;
}

export type ScheduleInput = Omit<Schedule, "id" | "lastRun" | "lastJobId" | "lastError">;
```

- [ ] **Step 2: In `web/src/api/client.ts`**, add `Schedule, ScheduleInput` to the `import type` list and these methods to `api`:

```ts
  schedules: () => request<{ schedules: Schedule[] }>("/api/schedules").then((r) => r.schedules),
  createSchedule: (input: ScheduleInput) =>
    request<{ schedule: Schedule }>("/api/schedules", { method: "POST", body: JSON.stringify(input) }).then((r) => r.schedule),
  updateSchedule: (id: string, patch: Partial<ScheduleInput>) =>
    request<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.schedule),
  deleteSchedule: (id: string) =>
    request<{ deleted: string }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runSchedule: (id: string) =>
    request<{ ran: string }>(`/api/schedules/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({}) }),
```

- [ ] **Step 3: Create `web/src/api/schedules.test.ts`**

```ts
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

test("schedules() unwraps the array", async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ schedules: [{ id: "s1", name: "n" }] }), { status: 200 })) as unknown as typeof fetch;
  expect(await api.schedules()).toEqual([{ id: "s1", name: "n" }]);
});

test("createSchedule posts the input and unwraps schedule", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ schedule: { id: "s2" } }), { status: 201 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const input = { name: "n", type: "copy" as const, isDir: true, src: { remote: "a", path: "", name: "" }, dst: { remote: "b", path: "", name: "" }, cron: "0 3 * * *", enabled: true };
  const out = await api.createSchedule(input);
  expect(out).toEqual({ id: "s2" });
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/schedules");
  expect(JSON.parse(init.body as string)).toEqual(input);
});

test("runSchedule posts to the run route", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ ran: "s1" }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.runSchedule("s1");
  const [url] = spy.mock.calls[0] as unknown as [string];
  expect(url).toBe("/api/schedules/s1/run");
});
```

- [ ] **Step 4: Run** `npm --workspace web run test schedules` → 3 passing. Full web suite green + build.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/api/schedules.test.ts
git commit -m "feat(web): schedules API client methods and types"
```

---

## Task 2: Schedules page + nav/route

**Files:** Create `web/src/pages/SchedulesPage.tsx`; modify `web/src/components/AppShell.tsx`, `web/src/App.tsx`; create `web/src/pages/SchedulesPage.test.tsx`.

- [ ] **Step 1: Create `web/src/pages/SchedulesPage.tsx`**

```tsx
import { useEffect, useState } from "react";
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
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="hint">{s.type} {s.src.remote}:{s.src.path}/{s.src.name} → {s.dst.remote}:{s.dst.path}</td>
              <td><code>{s.cron}</code></td>
              <td><button className="btn secondary" onClick={() => toggle(s)}>{s.enabled ? "on" : "off"}</button></td>
              <td className="hint">{statusOf(s)}</td>
              <td>
                <button className="btn secondary" onClick={() => run(s.id)}>Run now</button>{" "}
                <button className="btn secondary" onClick={() => startEdit(s)}>Edit</button>{" "}
                <button className="btn secondary" onClick={() => setPendingDelete(s.id)}>Delete</button>
              </td>
            </tr>
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
```

- [ ] **Step 2: Update `web/src/components/AppShell.tsx`**

Change `const SOON = ["Schedules"];` to `const SOON: string[] = [];` and add a NavLink after the Mounts link (before the now-empty `SOON.map`):
```tsx
        <NavLink to="/schedules" className={({ isActive }) => (isActive ? "active" : "")}>⏰ Schedules</NavLink>
```
(The `SOON.map` over an empty array renders nothing — leaving it is fine.)

- [ ] **Step 3: Update `web/src/App.tsx`**

```tsx
import { SchedulesPage } from "./pages/SchedulesPage.js";
```
```tsx
            <Route path="/schedules" element={<SchedulesPage />} />
```

- [ ] **Step 4: Create `web/src/pages/SchedulesPage.test.tsx`**

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SchedulesPage } from "./SchedulesPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
}

test("creates a schedule then runs it", async () => {
  setup();
  vi.spyOn(api, "schedules")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "s1", name: "nightly", type: "copy", isDir: true, src: { remote: "loc", path: "a", name: "" }, dst: { remote: "loc", path: "b", name: "" }, cron: "0 3 * * *", enabled: true }])
    .mockResolvedValue([{ id: "s1", name: "nightly", type: "copy", isDir: true, src: { remote: "loc", path: "a", name: "" }, dst: { remote: "loc", path: "b", name: "" }, cron: "0 3 * * *", enabled: true, lastJobId: 5, lastRun: "2026-01-01" }]);
  const create = vi.spyOn(api, "createSchedule").mockResolvedValue({ id: "s1", name: "nightly", type: "copy", isDir: true, src: { remote: "loc", path: "a", name: "" }, dst: { remote: "loc", path: "b", name: "" }, cron: "0 3 * * *", enabled: true });
  const run = vi.spyOn(api, "runSchedule").mockResolvedValue({ ran: "s1" });

  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("No schedules yet.")).toBeInTheDocument());

  await userEvent.type(screen.getByLabelText("Name"), "nightly");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0]).toMatchObject({ name: "nightly", type: "copy", cron: "0 3 * * *", src: { remote: "loc" } });

  await waitFor(() => expect(screen.getByText("nightly")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Run now" }));
  await waitFor(() => expect(run).toHaveBeenCalledWith("s1"));
});

test("applies a cron preset", async () => {
  setup();
  vi.spyOn(api, "schedules").mockResolvedValue([]);
  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("No schedules yet.")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Every hour" }));
  expect((screen.getByLabelText("Cron") as HTMLInputElement).value).toBe("0 * * * *");
});

test("deletes a schedule after confirmation", async () => {
  setup();
  vi.spyOn(api, "schedules")
    .mockResolvedValueOnce([{ id: "s1", name: "x", type: "copy", isDir: true, src: { remote: "loc", path: "", name: "" }, dst: { remote: "loc", path: "", name: "" }, cron: "0 3 * * *", enabled: true }])
    .mockResolvedValue([]);
  const del = vi.spyOn(api, "deleteSchedule").mockResolvedValue({ deleted: "s1" });
  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("x")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("s1"));
});
```

- [ ] **Step 5: Run** `npm --workspace web run test SchedulesPage` → 3 passing. Full web suite green + `npm --workspace web run build` clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/SchedulesPage.tsx web/src/components/AppShell.tsx web/src/App.tsx web/src/pages/SchedulesPage.test.tsx
git commit -m "feat(web): schedules page + enable Schedules nav"
```

---

## Self-review notes (against the spec)
- **Create/edit/delete/toggle/run-now + last-run status** → `SchedulesPage` (Task 2).
- **Cron presets + timezone/back-fill note** → form presets + hint text.
- **Schedules nav enabled** (last "soon" item) → `AppShell`/`App`.
- Reuses `useRemotes`, `ConfirmDialog`.

## Execution handoff
After this lands, Stage 4 is complete. Update CLAUDE.md, merge, push. Stage 5 (polish) would be the final roadmap item.
