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
