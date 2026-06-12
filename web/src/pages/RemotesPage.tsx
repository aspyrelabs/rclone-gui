import { useState } from "react";
import { api } from "../api/client.js";
import { useRemotes } from "../hooks/useRemotes.js";
import { RemoteCard } from "../components/RemoteCard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { RemoteWizard } from "../wizard/RemoteWizard.js";

export function RemotesPage() {
  const { remotes, loading, error, refresh } = useRemotes();
  const [wizard, setWizard] = useState<{ open: boolean; editName?: string }>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    await api.deleteRemote(pendingDelete);
    setPendingDelete(null);
    await refresh();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Remotes <span className="hint">{remotes.length} configured</span></h2>
        <button className="btn" onClick={() => setWizard({ open: true })}>+ Add remote</button>
      </div>

      {loading ? <p>Loading…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="cards">
        {remotes.map((r) => (
          <RemoteCard
            key={r.name}
            remote={r}
            onEdit={(name) => setWizard({ open: true, editName: name })}
            onDelete={(name) => setPendingDelete(name)}
          />
        ))}
      </div>

      {wizard.open ? (
        <RemoteWizard
          editName={wizard.editName}
          existing={remotes}
          onClose={() => setWizard({ open: false })}
          onSaved={async () => { setWizard({ open: false }); await refresh(); }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          message={`Delete remote "${pendingDelete}"? This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
