import type { RcOption } from "../api/types.js";
import { controlKind } from "../wizard/optionVisibility.js";
import { Tooltip } from "./Tooltip.js";

export function OptionField({
  option,
  value,
  onChange,
}: {
  option: RcOption;
  value: string;
  onChange: (next: string) => void;
}) {
  const kind = controlKind(option);
  const id = `opt-${option.Name}`;
  const listId = `${id}-list`;

  return (
    <div className="field">
      <label htmlFor={id}>
        {option.Name}
        {option.Required ? <span className="required"> *</span> : null}
        <Tooltip text={option.Help} />
      </label>

      {kind === "bool" ? (
        <input
          id={id}
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
      ) : kind === "select" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">(default)</option>
          {option.Examples!.map((ex) => (
            <option key={ex.Value} value={ex.Value}>
              {ex.Value}
              {ex.Help ? ` — ${ex.Help}` : ""}
            </option>
          ))}
        </select>
      ) : kind === "suggest" ? (
        <>
          <input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {option.Examples!.map((ex) => (
              <option key={ex.Value} value={ex.Value} />
            ))}
          </datalist>
        </>
      ) : (
        <input
          id={id}
          type={kind === "password" ? "password" : kind === "number" ? "number" : "text"}
          value={value}
          placeholder={option.DefaultStr || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {option.DefaultStr ? <span className="hint">default: {option.DefaultStr}</span> : null}
    </div>
  );
}
