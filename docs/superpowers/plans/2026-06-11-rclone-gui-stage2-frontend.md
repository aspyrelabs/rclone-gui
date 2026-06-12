# rclone GUI — Stage 2 Plan B: Frontend (Browse & Jobs UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the UI for Stage 2: a file browser (navigate a remote, create folder, delete), a copy/move transfer dialog, and a jobs page that polls live progress — wiring the previously-"soon" Browse and Jobs nav items to real pages.

**Architecture:** New API client methods + types over the Stage 2 backend endpoints, three new pages/components, and updated routing/sidebar. Live progress uses REST polling (1.5s while the Jobs page is mounted). Plain minimal CSS (visual polish deferred).

**Tech Stack:** unchanged (React 18, Vite, TS ESM, Vitest + RTL + user-event; mocked API client in tests).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-2-design.md`
**Builds on:** Stage 1 frontend + Stage 2 backend (both merged). Backend contract:
- `GET /api/browse?remote=&path=` → `{ entries: DirEntry[] }`
- `POST /api/browse/mkdir {remote,path,name}` → 201 · `POST /api/browse/delete {remote,path,name,isDir}` → 200
- `POST /api/jobs {type,isDir,src:PathRef,dst:PathRef}` → `{ jobid }` · `GET /api/jobs` → `{ jobs: JobInfo[] }` · `POST /api/jobs/:id/stop` → 200
- `DirEntry = {Path,Name,Size,ModTime,IsDir,MimeType}`; `PathRef = {remote,path,name}`; `JobInfo = {id,type,src,dst,finished,success,error,bytes,totalBytes,transfers,totalTransfers,speed,eta}`.

Existing reusable pieces: `api`/`ApiError` (`web/src/api/client.ts`), `useRemotes()` (returns `RemoteSummary[]`), `ConfirmDialog`, `AppShell` (currently lists Browse/Jobs/Mounts/Schedules as disabled "soon"), `App.tsx` router.

---

## File structure introduced/changed

```
web/src/
  api/types.ts            # + DirEntry, PathRef, JobType, LaunchInput, JobInfo
  api/client.ts           # + browse/mkdir/deletePath/listJobs/launchJob/stopJob
  pages/BrowsePage.tsx     # NEW: remote picker, breadcrumb, entries, mkdir/delete, transfer actions
  pages/JobsPage.tsx       # NEW: polling jobs table with progress + stop
  components/TransferDialog.tsx  # NEW: choose dest remote+path, copy/move
  hooks/useJobs.ts         # NEW: polling hook
  components/AppShell.tsx  # Browse + Jobs become real links
  App.tsx                  # + /browse and /jobs routes
  styles.css               # + a few classes (progress bar, table)
```

---

## Task 1: API client + types

**Files:** Modify `web/src/api/types.ts`, `web/src/api/client.ts`; create `web/src/api/browse.test.ts`.

- [ ] **Step 1: Add types to `web/src/api/types.ts`**

```ts
export interface DirEntry {
  Path: string;
  Name: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
  MimeType: string;
}

export type JobType = "copy" | "move";

export interface PathRef {
  remote: string;
  path: string;
  name: string;
}

export interface LaunchInput {
  type: JobType;
  isDir: boolean;
  src: PathRef;
  dst: PathRef;
}

export interface JobInfo {
  id: number;
  type: JobType;
  src: string;
  dst: string;
  finished: boolean;
  success: boolean;
  error: string;
  bytes: number;
  totalBytes: number;
  transfers: number;
  totalTransfers: number;
  speed: number;
  eta: number | null;
}
```

- [ ] **Step 2: Add methods to the `api` object in `web/src/api/client.ts`**

Add `DirEntry, JobInfo, LaunchInput` to the `import type { … } from "./types.js";` list, then add to `api`:
```ts
  browse: (remote: string, path: string) =>
    request<{ entries: DirEntry[] }>(`/api/browse?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(path)}`).then((r) => r.entries),
  mkdir: (remote: string, path: string, name: string) =>
    request<{ created: string }>("/api/browse/mkdir", { method: "POST", body: JSON.stringify({ remote, path, name }) }),
  deletePath: (remote: string, path: string, name: string, isDir: boolean) =>
    request<{ deleted: string }>("/api/browse/delete", { method: "POST", body: JSON.stringify({ remote, path, name, isDir }) }),
  listJobs: () => request<{ jobs: JobInfo[] }>("/api/jobs").then((r) => r.jobs),
  launchJob: (input: LaunchInput) =>
    request<{ jobid: number }>("/api/jobs", { method: "POST", body: JSON.stringify(input) }),
  stopJob: (id: number) =>
    request<{ stopped: number }>(`/api/jobs/${id}/stop`, { method: "POST", body: JSON.stringify({}) }),
```

- [ ] **Step 3: Write the failing test `web/src/api/browse.test.ts`**

```ts
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

test("browse() unwraps entries and encodes params", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ entries: [{ Name: "a.txt", IsDir: false }] }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const entries = await api.browse("my remote", "a/b");
  expect(entries).toEqual([{ Name: "a.txt", IsDir: false }]);
  const [url] = spy.mock.calls[0] as [string];
  expect(url).toBe("/api/browse?remote=my%20remote&path=a%2Fb");
});

test("launchJob posts the launch input", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ jobid: 7 }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const out = await api.launchJob({ type: "copy", isDir: true, src: { remote: "a", path: "", name: "d" }, dst: { remote: "b", path: "", name: "d" } });
  expect(out).toEqual({ jobid: 7 });
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toMatchObject({ type: "copy", src: { remote: "a" } });
});

test("stopJob posts to the stop route", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ stopped: 7 }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.stopJob(7);
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/jobs/7/stop");
  expect(init.method).toBe("POST");
});
```

- [ ] **Step 4: Run** `npm --workspace web run test browse` → 3 passing. Then full web suite green.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/api/browse.test.ts
git commit -m "feat(web): browse + jobs API client methods and types"
```

---

## Task 2: Browse page (navigate, mkdir, delete) + sidebar/route

**Files:** Create `web/src/pages/BrowsePage.tsx`; modify `web/src/components/AppShell.tsx`, `web/src/App.tsx`, `web/src/styles.css`; create `web/src/pages/BrowsePage.test.tsx`.

- [ ] **Step 1: Add styles to `web/src/styles.css`** (append)

```css
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px; }
.table tr.row-dir .name { cursor: pointer; color: #2563eb; }
.breadcrumb { margin: 8px 0; font-size: 13px; }
.breadcrumb a { color: #2563eb; cursor: pointer; }
.toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.progress { background: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden; }
.progress > div { background: #2563eb; height: 100%; }
```

- [ ] **Step 2: Create `web/src/pages/BrowsePage.tsx`**

```tsx
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

  // Default to the first remote once loaded.
  useEffect(() => {
    if (!remote && remotes.length > 0) setRemote(remotes[0].name);
  }, [remotes, remote]);

  async function refresh() {
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

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [remote, path]);

  const crumbs = path ? path.split("/") : [];

  async function newFolder() {
    const name = window.prompt("New folder name");
    if (!name) return;
    try {
      await api.mkdir(remote, path, name);
      await refresh();
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
    }
    setPendingDelete(null);
    await refresh();
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
        <a onClick={() => setPath("")}>{remote || "—"}:</a>
        {crumbs.map((seg, i) => (
          <span key={i}> / <a onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>{seg}</a></span>
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
```

- [ ] **Step 3: Update `web/src/components/AppShell.tsx`**

Change the `SOON` constant and add real links. Replace the nav body so Browse and Jobs are `NavLink`s and only Mounts/Schedules remain "soon":
```tsx
const SOON = ["Mounts", "Schedules"];
```
and inside the `<nav>`, after the Remotes `NavLink`, add:
```tsx
        <NavLink to="/browse" className={({ isActive }) => (isActive ? "active" : "")}>🗂 Browse</NavLink>
        <NavLink to="/jobs" className={({ isActive }) => (isActive ? "active" : "")}>⇄ Jobs</NavLink>
```
(keep the `SOON.map(...)` disabled spans for the remaining items, and the Settings link).

- [ ] **Step 4: Update `web/src/App.tsx`**

Import the new pages and add routes:
```tsx
import { BrowsePage } from "./pages/BrowsePage.js";
import { JobsPage } from "./pages/JobsPage.js";
```
Add inside `<Routes>`:
```tsx
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/jobs" element={<JobsPage />} />
```

NOTE: `JobsPage` and `TransferDialog` are created in later tasks. To keep THIS task building, create minimal placeholders now:
- `web/src/pages/JobsPage.tsx`:
```tsx
export function JobsPage() { return <div><h2>Jobs</h2></div>; }
```
- `web/src/components/TransferDialog.tsx`:
```tsx
import type { PathRef } from "../api/types.js";
export function TransferDialog(_props: {
  type: "copy" | "move"; src: PathRef; isDir: boolean; remotes: string[];
  onClose: () => void; onLaunched: () => void;
}) { return null; }
```
Tasks 3 and 4 replace these placeholders.

- [ ] **Step 5: Create `web/src/pages/BrowsePage.test.tsx`**

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BrowsePage } from "./BrowsePage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function mockRemotes() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
}

test("lists entries for the default remote and navigates into a folder", async () => {
  mockRemotes();
  const browse = vi.spyOn(api, "browse")
    .mockResolvedValueOnce([
      { Path: "sub", Name: "sub", Size: 0, ModTime: "", IsDir: true, MimeType: "" },
      { Path: "a.txt", Name: "a.txt", Size: 5, ModTime: "", IsDir: false, MimeType: "" },
    ])
    .mockResolvedValueOnce([
      { Path: "b.txt", Name: "b.txt", Size: 2, ModTime: "", IsDir: false, MimeType: "" },
    ]);

  render(<BrowsePage />);
  await waitFor(() => expect(screen.getByText("📁 sub")).toBeInTheDocument());

  await userEvent.click(screen.getByText("📁 sub"));
  await waitFor(() => expect(screen.getByText("📄 b.txt")).toBeInTheDocument());
  // browse was called for root then for "sub"
  expect(browse).toHaveBeenLastCalledWith("loc", "sub");
});

test("delete asks for confirmation then calls deletePath", async () => {
  mockRemotes();
  vi.spyOn(api, "browse").mockResolvedValue([
    { Path: "a.txt", Name: "a.txt", Size: 5, ModTime: "", IsDir: false, MimeType: "" },
  ]);
  const del = vi.spyOn(api, "deletePath").mockResolvedValue({ deleted: "a.txt" });

  render(<BrowsePage />);
  await waitFor(() => expect(screen.getByText("📄 a.txt")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("loc", "", "a.txt", false));
});
```

- [ ] **Step 6: Run** `npm --workspace web run test BrowsePage` → 2 passing. Then full web suite + `npm --workspace web run build`.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/BrowsePage.tsx web/src/pages/JobsPage.tsx web/src/components/TransferDialog.tsx web/src/components/AppShell.tsx web/src/App.tsx web/src/styles.css web/src/pages/BrowsePage.test.tsx
git commit -m "feat(web): browse page (navigate/mkdir/delete) + enable Browse/Jobs nav"
```

---

## Task 3: Transfer dialog (copy/move to a destination)

**Files:** Replace `web/src/components/TransferDialog.tsx`; create `web/src/components/TransferDialog.test.tsx`.

- [ ] **Step 1: REPLACE `web/src/components/TransferDialog.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `web/src/components/TransferDialog.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { TransferDialog } from "./TransferDialog.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("launches a copy job to the chosen destination", async () => {
  const launch = vi.spyOn(api, "launchJob").mockResolvedValue({ jobid: 1 });
  const onLaunched = vi.fn();
  render(
    <TransferDialog
      type="copy"
      src={{ remote: "loc", path: "docs", name: "a.txt" }}
      isDir={false}
      remotes={["loc", "s3"]}
      onClose={() => {}}
      onLaunched={onLaunched}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Destination remote"), "s3");
  await userEvent.clear(screen.getByLabelText(/Destination folder/));
  await userEvent.type(screen.getByLabelText(/Destination folder/), "backup");
  await userEvent.click(screen.getByRole("button", { name: "Start copy" }));

  await waitFor(() => expect(launch).toHaveBeenCalledWith({
    type: "copy",
    isDir: false,
    src: { remote: "loc", path: "docs", name: "a.txt" },
    dst: { remote: "s3", path: "backup", name: "a.txt" },
  }));
  await waitFor(() => expect(onLaunched).toHaveBeenCalled());
});
```

- [ ] **Step 3: Run** `npm --workspace web run test TransferDialog` → 1 passing. Then full web suite + build.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TransferDialog.tsx web/src/components/TransferDialog.test.tsx
git commit -m "feat(web): transfer dialog to launch copy/move jobs"
```

---

## Task 4: Jobs page with polling

**Files:** Create `web/src/hooks/useJobs.ts`; replace `web/src/pages/JobsPage.tsx`; create `web/src/pages/JobsPage.test.tsx`.

- [ ] **Step 1: Create `web/src/hooks/useJobs.ts`**

```ts
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
```

- [ ] **Step 2: REPLACE `web/src/pages/JobsPage.tsx`**

```tsx
import { api } from "../api/client.js";
import type { JobInfo } from "../api/types.js";
import { useJobs } from "../hooks/useJobs.js";

function pct(j: JobInfo): number {
  if (!j.totalBytes) return j.finished ? 100 : 0;
  return Math.min(100, Math.round((j.bytes / j.totalBytes) * 100));
}

function statusOf(j: JobInfo): string {
  if (!j.finished) return "running";
  return j.success ? "done" : "error";
}

export function JobsPage() {
  const { jobs, error } = useJobs();

  return (
    <div>
      <h2>Jobs</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {jobs.length === 0 ? <p className="hint">No jobs yet. Start a copy or move from the Browse page.</p> : null}
      <table className="table">
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                <div>{j.type}: <b>{j.src}</b> → <b>{j.dst}</b></div>
                <div className="progress"><div style={{ width: `${pct(j)}%` }} /></div>
                <div className="hint">
                  {statusOf(j)} · {j.bytes}/{j.totalBytes} bytes · {j.transfers}/{j.totalTransfers} files
                  {j.speed ? ` · ${Math.round(j.speed)} B/s` : ""}
                  {j.error ? ` · ${j.error}` : ""}
                </div>
              </td>
              <td>
                {!j.finished ? (
                  <button className="btn secondary" onClick={() => void api.stopJob(j.id)}>Stop</button>
                ) : (
                  <span className={j.success ? "status-ok" : "status-error"}>● {statusOf(j)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/pages/JobsPage.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { JobsPage } from "./JobsPage.js";
import { api } from "../api/client.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("renders a running job with progress and a Stop button", async () => {
  vi.spyOn(api, "listJobs").mockResolvedValue([
    { id: 3, type: "copy", src: "loc:docs/a.txt", dst: "s3:backup/a.txt", finished: false, success: false, error: "", bytes: 50, totalBytes: 100, transfers: 0, totalTransfers: 1, speed: 1024, eta: 1 },
  ]);
  const stop = vi.spyOn(api, "stopJob").mockResolvedValue({ stopped: 3 });

  render(<JobsPage />);
  await vi.waitFor(() => expect(screen.getByText(/loc:docs\/a\.txt/)).toBeInTheDocument());
  expect(screen.getByText(/running/)).toBeInTheDocument();

  await screen.getByRole("button", { name: "Stop" }).click();
  expect(stop).toHaveBeenCalledWith(3);
});

test("shows the empty hint when there are no jobs", async () => {
  vi.spyOn(api, "listJobs").mockResolvedValue([]);
  render(<JobsPage />);
  await vi.waitFor(() => expect(screen.getByText(/No jobs yet/)).toBeInTheDocument());
});
```

NOTE on the test: it uses fake timers because the hook sets an interval. `vi.waitFor` advances microtasks; if the running-job text doesn't appear, call `await vi.advanceTimersByTimeAsync(0)` after render to flush the initial `refresh()` promise. Use `.click()` directly (as shown) rather than `userEvent` under fake timers to avoid user-event's own timer waits; if `userEvent` is needed, configure it with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. The `userEvent` import may be unused — remove it if so to keep the build clean.

- [ ] **Step 4: Run** `npm --workspace web run test JobsPage` → 2 passing. If fake-timer flushing is fiddly, the simplest robust pattern is: `render`, then `await vi.advanceTimersByTimeAsync(0)` to flush the initial fetch, then assert. Then full web suite + `npm --workspace web run build`.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useJobs.ts web/src/pages/JobsPage.tsx web/src/pages/JobsPage.test.tsx
git commit -m "feat(web): jobs page with live polling, progress, and stop"
```

---

## Self-review notes (author check against the spec)

- **Browse one remote, dir-at-a-time, breadcrumb** → `BrowsePage` (Task 2).
- **mkdir / delete (with confirm for recursive)** → `BrowsePage` + `ConfirmDialog` (Task 2).
- **Copy/move to a destination remote+path** → `TransferDialog` → `api.launchJob` (Task 3).
- **Live progress via polling, with stop** → `useJobs` (1.5s) + `JobsPage` (Task 4).
- **Enable Browse + Jobs nav** → `AppShell`/`App` (Task 2).

Deferred (per spec): uploads, drag-drop, multi-select, rename UI (move-to with a new name could add it later), WebSocket push (polling used).

## Execution handoff
After this lands, Stage 2 is complete. Manual end-to-end check: run backend (`RCLONE_BINARY=… npm --workspace server run dev`) + `npm --workspace web run dev`, configure a local remote, browse it, copy a folder to another remote, watch progress on the Jobs page.
