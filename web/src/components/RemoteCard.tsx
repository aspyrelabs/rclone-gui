import { useState } from "react";
import { api } from "../api/client.js";
import type { RemoteSummary } from "../api/types.js";

type Status = "untested" | "testing" | "ok" | "error";

export function RemoteCard({
  remote,
  onEdit,
  onDelete,
}: {
  remote: RemoteSummary;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [status, setStatus] = useState<Status>("untested");
  const [detail, setDetail] = useState<string | null>(null);

  async function test() {
    setStatus("testing");
    setDetail(null);
    try {
      const r = await api.testRemote(remote.name);
      setStatus(r.ok ? "ok" : "error");
      if (!r.ok) setDetail(r.detail ?? "connection failed");
    } catch (e) {
      setStatus("error");
      setDetail((e as Error).message);
    }
  }

  const cls =
    status === "ok" ? "status-ok" : status === "error" ? "status-error" : "status-untested";

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <b>{remote.name}</b>
        <span className={cls}>● {status}</span>
      </div>
      <div className="hint">Type: {remote.type}</div>
      {detail ? <div className="error-text">{detail}</div> : null}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn secondary" onClick={() => onEdit(remote.name)}>Edit</button>
        <button className="btn secondary" onClick={test}>Test</button>
        <button className="btn secondary" onClick={() => onDelete(remote.name)}>Delete</button>
      </div>
    </div>
  );
}
