# rclone GUI — Stage 5 Plan B: Frontend (Bandwidth & Run History UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a Bandwidth-limit section to Settings and a run-history view to the Schedules page.

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-5-design.md`
**Builds on:** Stages 1–4 frontend + Stage 5 backend (merged). Backend: `GET /api/bwlimit` → `BwLimit`, `POST /api/bwlimit {rate}` → `BwLimit`; schedules now include `history: RunRecord[]`. Existing: `SettingsPage` (rclone version section), `SchedulesPage`, `api` client.

Backend types: `BwLimit = {rate, bytesPerSecond, bytesPerSecondRx, bytesPerSecondTx}`; `RunRecord = {time, jobId?, error?}`.

---

## Task 1: bwlimit API + Settings section

**Files:** Modify `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/pages/SettingsPage.tsx`, `web/src/pages/SettingsPage.test.tsx`.

- [ ] **Step 1: Append to `web/src/api/types.ts`**

```ts
export interface BwLimit {
  rate: string;
  bytesPerSecond: number;
  bytesPerSecondRx: number;
  bytesPerSecondTx: number;
}

export interface RunRecord {
  time: string;
  jobId?: number;
  error?: string;
}
```
Also add `history?: RunRecord[];` to the existing `Schedule` interface (used by Task 2).

- [ ] **Step 2: In `web/src/api/client.ts`**, add `BwLimit` to the `import type` list and these methods to `api`:

```ts
  bwlimit: () => request<BwLimit>("/api/bwlimit"),
  setBwlimit: (rate: string) =>
    request<BwLimit>("/api/bwlimit", { method: "POST", body: JSON.stringify({ rate }) }),
```

- [ ] **Step 3: REPLACE `web/src/pages/SettingsPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { BwLimit, VersionStatus } from "../api/types.js";

export function SettingsPage() {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bw, setBw] = useState<BwLimit | null>(null);
  const [rate, setRate] = useState("");
  const [bwBusy, setBwBusy] = useState(false);

  const loadVersion = () => api.version().then(setStatus).catch((e: Error) => setError(e.message));
  const loadBw = () => api.bwlimit().then(setBw).catch((e: Error) => setError(e.message));
  useEffect(() => { void loadVersion(); void loadBw(); }, []);

  async function update() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.updateRclone());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyBw(r: string) {
    setBwBusy(true);
    setError(null);
    try {
      setBw(await api.setBwlimit(r));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBwBusy(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      {error ? <p className="error-text">{error}</p> : null}

      <h3>rclone version</h3>
      {!status ? (
        <p>Loading…</p>
      ) : (
        <div>
          <p>
            Installed: <b>{status.installed ?? "unknown"}</b>
            {status.latest ? <> · Latest: <b>{status.latest}</b></> : <> · Latest: <span className="hint">unknown (offline?)</span></>}
          </p>
          {status.updateAvailable ? (
            <button className="btn" disabled={busy} onClick={update}>
              {busy ? "Updating…" : `Update to ${status.latest}`}
            </button>
          ) : (
            <p className="hint">{status.installed ? "Up to date." : "No version detected."}</p>
          )}
        </div>
      )}

      <h3>Bandwidth limit</h3>
      {!bw ? (
        <p>Loading…</p>
      ) : (
        <div>
          <p>
            Current: <b>{bw.rate}</b>{bw.bytesPerSecond > 0 ? ` (${bw.bytesPerSecond} B/s)` : " — unlimited"}
          </p>
          <div className="toolbar">
            <input aria-label="Bandwidth rate" placeholder="e.g. 1M, 512k" value={rate} onChange={(e) => setRate(e.target.value)} />
            <button className="btn" disabled={bwBusy || !rate} onClick={() => applyBw(rate)}>{bwBusy ? "Applying…" : "Apply"}</button>
            <button className="btn secondary" disabled={bwBusy} onClick={() => applyBw("off")}>Set unlimited</button>
          </div>
          <p className="hint">Applies to all transfers. Not persisted across restarts.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: REPLACE `web/src/pages/SettingsPage.test.tsx`** (mocks both version + bwlimit; keeps version coverage and adds bwlimit)

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

const OFF = { rate: "off", bytesPerSecond: -1, bytesPerSecondRx: -1, bytesPerSecondTx: -1 };

test("shows version + offers update; bandwidth shows unlimited", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
  vi.spyOn(api, "updateRclone").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  vi.spyOn(api, "bwlimit").mockResolvedValue(OFF);

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("v1.74.3")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/unlimited/)).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: /Update to v1.75.0/ }));
  await waitFor(() => expect(screen.getByText("Up to date.")).toBeInTheDocument());
});

test("applies a bandwidth limit", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  vi.spyOn(api, "bwlimit").mockResolvedValue(OFF);
  const setBw = vi.spyOn(api, "setBwlimit").mockResolvedValue({ rate: "1Mi", bytesPerSecond: 1048576, bytesPerSecondRx: 1048576, bytesPerSecondTx: 1048576 });

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText(/unlimited/)).toBeInTheDocument());

  await userEvent.type(screen.getByLabelText("Bandwidth rate"), "1M");
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(setBw).toHaveBeenCalledWith("1M"));
  await waitFor(() => expect(screen.getByText("1Mi")).toBeInTheDocument());
});

test("set unlimited posts off", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  vi.spyOn(api, "bwlimit").mockResolvedValue({ rate: "1Mi", bytesPerSecond: 1048576, bytesPerSecondRx: 1048576, bytesPerSecondTx: 1048576 });
  const setBw = vi.spyOn(api, "setBwlimit").mockResolvedValue(OFF);

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("1Mi")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Set unlimited" }));
  await waitFor(() => expect(setBw).toHaveBeenCalledWith("off"));
});
```

- [ ] **Step 5: Run** `npm --workspace web run test SettingsPage` → 3 passing. Full web suite green + `npm --workspace web run build` clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/pages/SettingsPage.tsx web/src/pages/SettingsPage.test.tsx
git commit -m "feat(web): bandwidth-limit controls in Settings"
```

---

## Task 2: Run-history view on Schedules

**Files:** Modify `web/src/pages/SchedulesPage.tsx`, `web/src/pages/SchedulesPage.test.tsx`.

- [ ] **Step 1: Edit `web/src/pages/SchedulesPage.tsx`**

Add an expandable history view per row. READ the file first. Make these changes:

1. Add state for the expanded row:
```tsx
  const [historyId, setHistoryId] = useState<string | null>(null);
```
2. In the actions cell of each schedule row, add a History toggle button (alongside Run now / Edit / Delete):
```tsx
                <button className="btn secondary" onClick={() => setHistoryId(historyId === s.id ? null : s.id)}>History</button>{" "}
```
3. After each schedule's `<tr>`, conditionally render a history sub-row when expanded. Since a `<tr>` cannot contain arbitrary siblings, render the history row as a sibling `<tr>` inside the same `.map` by returning a fragment. Change the `.map` body to return a React fragment keyed by `s.id` containing the existing row plus an optional history row:
```tsx
          {schedules.map((s) => (
            <Fragment key={s.id}>
              <tr>
                {/* ... existing cells (name, transfer, cron, enabled, status, actions incl. the new History button) ... */}
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
```
   Remove the old `key={s.id}` from the inner `<tr>` (the key moves to the `Fragment`). Import `Fragment`:
```tsx
import { Fragment, useEffect, useState } from "react";
```
   Keep the existing "No schedules yet." empty row as-is (after the map).

- [ ] **Step 2: Add a test to `web/src/pages/SchedulesPage.test.tsx`** (keep existing tests)

```tsx
test("expands a schedule's run history", async () => {
  setup();
  vi.spyOn(api, "schedules").mockResolvedValue([{
    id: "s1", name: "h", type: "copy", isDir: true,
    src: { remote: "loc", path: "", name: "" }, dst: { remote: "loc", path: "", name: "" },
    cron: "0 3 * * *", enabled: true,
    history: [
      { time: "2026-01-02T00:00:00Z", error: "boom" },
      { time: "2026-01-01T00:00:00Z", jobId: 7 },
    ],
  }]);
  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("h")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "History" }));
  await waitFor(() => expect(screen.getByText(/job 7/)).toBeInTheDocument());
  expect(screen.getByText(/error: boom/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run** `npm --workspace web run test SchedulesPage` → existing 3 + 1 new pass. Full web suite green + `npm --workspace web run build` clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/SchedulesPage.tsx web/src/pages/SchedulesPage.test.tsx
git commit -m "feat(web): run-history view on schedules"
```

---

## Self-review notes
- **bwlimit current + set + unlimited** → Settings section (Task 1), reuses `BwLimit`.
- **Per-schedule run history, expandable** → Schedules row (Task 2), uses `Schedule.history`.
- Existing version + schedule tests preserved (version tests now also mock `api.bwlimit`).

## Execution handoff
After this lands, Stage 5 (scoped polish) is complete. Update CLAUDE.md, merge, push. Remaining optional: notifications, multi-user, persisted bwlimit, missed-run backfill.
