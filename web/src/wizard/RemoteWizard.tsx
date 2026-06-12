import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import type { ConfigOut, RcProvider, RemoteSummary } from "../api/types.js";
import { useProviders } from "../hooks/useProviders.js";
import { OptionField } from "../components/OptionField.js";
import { partitionOptions } from "./optionVisibility.js";

type Step = "type" | "basic" | "advanced";
const NAME_RE = /^[\w.+@-]+$/;

export function RemoteWizard({
  editName,
  existing,
  onClose,
  onSaved,
}: {
  editName?: string;
  existing: RemoteSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { providers } = useProviders();
  const editingRemote = editName ? existing.find((r) => r.name === editName) : undefined;

  const [step, setStep] = useState<Step>(editName ? "basic" : "type");
  const [search, setSearch] = useState("");
  const [name, setName] = useState(editName ?? "");
  const [type, setType] = useState(editingRemote?.type ?? "");
  const [values, setValues] = useState<Record<string, string>>(editingRemote?.parameters ?? {});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ConfigOut | null>(null);
  const [busy, setBusy] = useState(false);

  const provider: RcProvider | undefined = useMemo(
    () => providers?.find((p) => p.Name === type),
    [providers, type],
  );
  const { basic, advanced } = useMemo(
    () => (provider ? partitionOptions(provider.Options, values.provider) : { basic: [], advanced: [] }),
    [provider, values.provider],
  );

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  function validateName(): string | null {
    if (!NAME_RE.test(name)) return "Name may contain only letters, numbers and . + @ - _";
    if (!editName && existing.some((r) => r.name === name)) return "A remote with that name already exists";
    return null;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editName) {
        await api.updateRemote(editName, values);
        onSaved();
        return;
      }
      const params = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
      const res = await api.createRemote(name, type, params);
      if (res.pending) {
        setPending(res.pending);
      } else {
        onSaved();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function continueConfig(result: string) {
    if (!pending?.State) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.continueRemote(name, pending.State, result);
      if (res.pending) setPending(res.pending);
      else onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>{editName ? `Edit ${editName}` : "Add remote"}</h2>
          <button className="btn secondary" onClick={onClose}>✕</button>
        </div>

        <div className="steps">
          {(["type", "basic", "advanced"] as Step[]).map((s) => (
            <span key={s} className={`step${s === step ? " active" : ""}`}>{s}</span>
          ))}
        </div>

        {pending ? (
          <PendingStep key={pending.State} pending={pending} busy={busy} error={error} onContinue={continueConfig} />
        ) : step === "type" ? (
          <div>
            <input
              className="wizard-search"
              placeholder="Search backends…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search backends"
            />
            <div className="backend-list">
              {(providers ?? [])
                .filter((p) => p.Name.toLowerCase().includes(search.toLowerCase()) || p.Description.toLowerCase().includes(search.toLowerCase()))
                .map((p) => (
                  <label key={p.Name} className="backend-option">
                    <input
                      type="radio"
                      name="backend"
                      checked={type === p.Name}
                      onChange={() => setType(p.Name)}
                    />
                    <span>
                      <span className="backend-name">{p.Name}</span>
                      <span className="backend-desc">{p.Description}</span>
                    </span>
                  </label>
                ))}
            </div>
            <div className="field">
              <label htmlFor="remote-name">Remote name <span className="required">*</span></label>
              <input id="remote-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            <WizardNav
              onBack={onClose}
              backLabel="Cancel"
              nextLabel="Next"
              nextDisabled={!type || !name}
              onNext={() => {
                const nameErr = validateName();
                if (nameErr) return setError(nameErr);
                setError(null);
                setStep("basic");
              }}
            />
          </div>
        ) : step === "basic" ? (
          <div>
            {basic.map((o) => (
              <OptionField key={o.Name} option={o} value={values[o.Name] ?? ""} onChange={(v) => set(o.Name, v)} />
            ))}
            {basic.length === 0 ? <p className="hint">No basic options for this backend.</p> : null}
            <WizardNav
              onBack={() => (editName ? onClose() : setStep("type"))}
              backLabel={editName ? "Cancel" : "Back"}
              nextLabel="Advanced"
              onNext={() => setStep("advanced")}
            />
          </div>
        ) : (
          <div>
            <details>
              <summary>Advanced ({advanced.length})</summary>
              {advanced.map((o) => (
                <OptionField key={o.Name} option={o} value={values[o.Name] ?? ""} onChange={(v) => set(o.Name, v)} />
              ))}
            </details>
            {error ? <p className="error-text">{error}</p> : null}
            <WizardNav
              onBack={() => setStep("basic")}
              backLabel="Back"
              nextLabel={busy ? "Saving…" : "Save"}
              nextDisabled={busy}
              onNext={save}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function WizardNav({
  onBack,
  backLabel,
  onNext,
  nextLabel,
  nextDisabled,
}: {
  onBack: () => void;
  backLabel: string;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
      <button className="btn secondary" onClick={onBack}>{backLabel}</button>
      <button className="btn" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>
    </div>
  );
}

function PendingStep({
  pending,
  busy,
  error,
  onContinue,
}: {
  pending: ConfigOut;
  busy: boolean;
  error: string | null;
  onContinue: (result: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const opt = pending.Option;
  return (
    <div>
      <p className="hint">This backend needs an extra step to finish configuring.</p>
      {opt ? (
        <OptionField option={opt} value={answer} onChange={setAnswer} />
      ) : (
        <p>{pending.Error ?? "Continue to proceed."}</p>
      )}
      {error ? <p className="error-text">{error}</p> : null}
      <div style={{ marginTop: 14, textAlign: "right" }}>
        <button className="btn" disabled={busy} onClick={() => onContinue(answer)}>
          {busy ? "Working…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
