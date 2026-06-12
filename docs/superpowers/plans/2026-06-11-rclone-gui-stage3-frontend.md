# rclone GUI — Stage 3 Plan B: Frontend (Serve & Mounts UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** UI for Stage 3: a Serve page (start/list/stop `rclone serve` instances) and a Mounts page (mount/list/unmount, with a FUSE-privileges note), with the Serve and Mounts nav items enabled.

**Architecture:** API client methods + types over the Stage 3 backend, two new pages, updated routing/sidebar. Minimal CSS (reuses Stage 2 `.table`/`.toolbar`/`.field` classes).

**Tech Stack:** unchanged (React 18, Vite, TS ESM, Vitest + RTL + user-event; mocked API in tests).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-3-design.md`
**Builds on:** Stages 1–2 frontend + Stage 3 backend (merged). Backend contract:
- `GET /api/serve/types` → `{types:string[]}`; `GET /api/serve` → `{serves: ServeInstance[]}`; `POST /api/serve {type,remote,path?,addr?}` → `{id,addr}`; `POST /api/serve/:id/stop` → 200
- `GET /api/mounts/types` → `{types:string[]}`; `GET /api/mounts` → `{mounts: MountInstance[]}`; `POST /api/mounts {remote,path?,mountPoint,mountType?}` → 201; `POST /api/mounts/unmount {mountPoint}` → 200
- `ServeInstance = {id,addr,type,fs}`; `MountInstance = {fs,mountPoint}`.

Existing reusable: `api`/`ApiError`, `useRemotes()`, `AppShell` (SOON currently `["Mounts","Schedules"]`), `App.tsx` router. The `.table`, `.toolbar`, `.field`, `.error-text`, `.hint`, `.btn` classes already exist.

---

## File structure introduced/changed

```
web/src/
  api/types.ts            # + ServeInstance, MountInstance
  api/client.ts           # + serveTypes/serves/startServe/stopServe/mountTypes/mounts/mount/unmount
  pages/ServePage.tsx     # NEW
  pages/MountsPage.tsx    # NEW
  components/AppShell.tsx  # Serve + Mounts become real links
  App.tsx                  # + /serve and /mounts routes
```

---

## Task 1: API client + types

**Files:** Modify `web/src/api/types.ts`, `web/src/api/client.ts`; create `web/src/api/serve.test.ts`.

- [ ] **Step 1: Append to `web/src/api/types.ts`**

```ts
export interface ServeInstance {
  id: string;
  addr: string;
  type: string;
  fs: string;
}

export interface MountInstance {
  fs: string;
  mountPoint: string;
}
```

- [ ] **Step 2: In `web/src/api/client.ts`**, add `ServeInstance, MountInstance` to the `import type` list and these methods to `api`:

```ts
  serveTypes: () => request<{ types: string[] }>("/api/serve/types").then((r) => r.types),
  serves: () => request<{ serves: ServeInstance[] }>("/api/serve").then((r) => r.serves),
  startServe: (body: { type: string; remote: string; path?: string; addr?: string }) =>
    request<{ id: string; addr: string }>("/api/serve", { method: "POST", body: JSON.stringify(body) }),
  stopServe: (id: string) =>
    request<{ stopped: string }>(`/api/serve/${encodeURIComponent(id)}/stop`, { method: "POST", body: JSON.stringify({}) }),
  mountTypes: () => request<{ types: string[] }>("/api/mounts/types").then((r) => r.types),
  mounts: () => request<{ mounts: MountInstance[] }>("/api/mounts").then((r) => r.mounts),
  mount: (body: { remote: string; path?: string; mountPoint: string; mountType?: string }) =>
    request<{ mounted: string }>("/api/mounts", { method: "POST", body: JSON.stringify(body) }),
  unmount: (mountPoint: string) =>
    request<{ unmounted: string }>("/api/mounts/unmount", { method: "POST", body: JSON.stringify({ mountPoint }) }),
```

- [ ] **Step 3: Create `web/src/api/serve.test.ts`**

```ts
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

test("serves() unwraps the serves array", async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ serves: [{ id: "http-1", addr: "127.0.0.1:8080", type: "http", fs: "loc:" }] }), { status: 200 })) as unknown as typeof fetch;
  expect(await api.serves()).toEqual([{ id: "http-1", addr: "127.0.0.1:8080", type: "http", fs: "loc:" }]);
});

test("startServe posts the body", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ id: "http-2", addr: "x" }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.startServe({ type: "http", remote: "loc", path: "d", addr: "0.0.0.0:8080" });
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/serve");
  expect(JSON.parse(init.body as string)).toEqual({ type: "http", remote: "loc", path: "d", addr: "0.0.0.0:8080" });
});

test("unmount posts the mountPoint", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ unmounted: "/mnt/x" }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.unmount("/mnt/x");
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/mounts/unmount");
  expect(JSON.parse(init.body as string)).toEqual({ mountPoint: "/mnt/x" });
});
```

- [ ] **Step 4: Run** `npm --workspace web run test serve` → 3 passing. Full web suite green. `npm --workspace web run build` clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/api/serve.test.ts
git commit -m "feat(web): serve + mounts API client methods and types"
```

---

## Task 2: Serve page + nav/route

**Files:** Create `web/src/pages/ServePage.tsx`; modify `web/src/components/AppShell.tsx`, `web/src/App.tsx`; create `web/src/pages/ServePage.test.tsx`.

- [ ] **Step 1: Create `web/src/pages/ServePage.tsx`**

```tsx
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
```

- [ ] **Step 2: Update `web/src/components/AppShell.tsx`**

Change `const SOON = ["Mounts", "Schedules"];` to `const SOON = ["Schedules"];` and add two `NavLink`s after the Jobs link (before the `SOON.map`):
```tsx
        <NavLink to="/serve" className={({ isActive }) => (isActive ? "active" : "")}>🔌 Serve</NavLink>
        <NavLink to="/mounts" className={({ isActive }) => (isActive ? "active" : "")}>💾 Mounts</NavLink>
```

- [ ] **Step 3: Update `web/src/App.tsx`**

Add imports and routes:
```tsx
import { ServePage } from "./pages/ServePage.js";
import { MountsPage } from "./pages/MountsPage.js";
```
```tsx
            <Route path="/serve" element={<ServePage />} />
            <Route path="/mounts" element={<MountsPage />} />
```
NOTE: `MountsPage` is created in Task 3 — create a minimal placeholder now so this builds:
`web/src/pages/MountsPage.tsx`:
```tsx
export function MountsPage() { return <div><h2>Mounts</h2></div>; }
```

- [ ] **Step 4: Create `web/src/pages/ServePage.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ServePage } from "./ServePage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
  vi.spyOn(api, "serveTypes").mockResolvedValue(["http", "webdav", "sftp"]);
}

test("starts a serve and shows it, then stops it", async () => {
  setup();
  const serves = vi.spyOn(api, "serves")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "http-1", addr: "0.0.0.0:8080", type: "http", fs: "loc:" }])
    .mockResolvedValue([]);
  const start = vi.spyOn(api, "startServe").mockResolvedValue({ id: "http-1", addr: "0.0.0.0:8080" });
  const stop = vi.spyOn(api, "stopServe").mockResolvedValue({ stopped: "http-1" });

  render(<ServePage />);
  await waitFor(() => expect(screen.getByText("No active serves.")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Start serve" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith({ type: "http", remote: "loc", path: "", addr: "0.0.0.0:8080" }));
  await waitFor(() => expect(screen.getByText("loc:")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(stop).toHaveBeenCalledWith("http-1"));
  void serves;
});
```

- [ ] **Step 5: Run** `npm --workspace web run test ServePage` → 1 passing. Full suite green + build.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ServePage.tsx web/src/pages/MountsPage.tsx web/src/components/AppShell.tsx web/src/App.tsx web/src/pages/ServePage.test.tsx
git commit -m "feat(web): serve page + enable Serve/Mounts nav"
```

---

## Task 3: Mounts page

**Files:** Replace `web/src/pages/MountsPage.tsx`; create `web/src/pages/MountsPage.test.tsx`.

- [ ] **Step 1: REPLACE `web/src/pages/MountsPage.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `web/src/pages/MountsPage.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MountsPage } from "./MountsPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
  vi.spyOn(api, "mountTypes").mockResolvedValue(["nfsmount", "cmount"]);
}

test("shows the FUSE note and lists no mounts initially", async () => {
  setup();
  vi.spyOn(api, "mounts").mockResolvedValue([]);
  render(<MountsPage />);
  expect(screen.getByText(/FUSE/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("No active mounts.")).toBeInTheDocument());
});

test("mounts and then unmounts", async () => {
  setup();
  vi.spyOn(api, "mounts")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ fs: "loc:data", mountPoint: "/mnt/x" }])
    .mockResolvedValue([]);
  const mount = vi.spyOn(api, "mount").mockResolvedValue({ mounted: "/mnt/x" });
  const unmount = vi.spyOn(api, "unmount").mockResolvedValue({ unmounted: "/mnt/x" });

  render(<MountsPage />);
  await waitFor(() => expect(screen.getByText("No active mounts.")).toBeInTheDocument());

  await userEvent.type(screen.getByLabelText("Path"), "data");
  await userEvent.type(screen.getByLabelText("Mount point"), "/mnt/x");
  await userEvent.click(screen.getByRole("button", { name: "Mount" }));
  await waitFor(() => expect(mount).toHaveBeenCalledWith({ remote: "loc", path: "data", mountPoint: "/mnt/x", mountType: undefined }));
  await waitFor(() => expect(screen.getByText("/mnt/x")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Unmount" }));
  await waitFor(() => expect(unmount).toHaveBeenCalledWith("/mnt/x"));
});
```

- [ ] **Step 3: Run** `npm --workspace web run test MountsPage` → 2 passing. Full web suite green + `npm --workspace web run build` clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/MountsPage.tsx web/src/pages/MountsPage.test.tsx
git commit -m "feat(web): mounts page with FUSE-privileges note"
```

---

## Self-review notes (against the spec)
- **Serve start/list/stop with type+remote+path+addr; http/webdav address linkified** → `ServePage` (Task 2).
- **Mount mount/list/unmount with FUSE privileges note** → `MountsPage` (Task 3).
- **Nav enabled for Serve + Mounts** → `AppShell`/`App` (Task 2).
- Deferred (per spec): serve auth/vfs options, re-establish on restart.

## Execution handoff
After this lands, Stage 3 is complete. Update CLAUDE.md, merge, push. Stage 4 (scheduling) would be next.
