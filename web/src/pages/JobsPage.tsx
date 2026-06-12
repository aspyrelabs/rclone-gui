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
