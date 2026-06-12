# rclone GUI — Stage 1 Plan 2: Frontend (React + Vite SPA)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React + Vite single-page app that consumes the Plan 1 backend API: an app shell with a remotes dashboard and an add/edit wizard whose fields, tooltips, and defaults are auto-generated from rclone's `config/providers` metadata, plus optional-auth login handling.

**Architecture:** A Vite-built React 18 SPA in the `web/` workspace. A typed API client wraps the backend's `/api/*` REST endpoints. A single `OptionField` component renders any rclone option (from its `RcOption` metadata) as the correct control with a tooltip and default. The add/edit flow is a 4-step wizard. In dev, Vite proxies `/api` to the backend on `:3000`; in production (Plan 3) the backend serves the built static assets.

**Tech Stack:** React 18, Vite 5, TypeScript (ESM), `react-router-dom` v6, Vitest + `@testing-library/react` + `@testing-library/user-event` + `jsdom`. No data-fetching library — plain `fetch` via the typed client and small hooks (keeps deps minimal and behavior predictable).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-1-design.md`
**Builds on:** Plan 1 (backend). The backend API contract this plan targets:
- `GET /api/auth/status` → `{ protected: boolean, authenticated: boolean }`
- `POST /api/auth/login` `{ password }` → `{ authenticated: true }` | 401 `{ error }`
- `GET /api/providers` → `{ providers: RcProvider[] }`
- `GET /api/remotes` → `{ remotes: RemoteSummary[] }`
- `POST /api/remotes` `{ name, type, parameters }` → 201 `{ created }` | 200 `{ pending: ConfigOut }` | 400 `{ error }`
- `POST /api/remotes/:name/continue` `{ state, result }` → 200 `{ created }` | 200 `{ pending: ConfigOut }`
- `PUT /api/remotes/:name` `{ parameters }` → 200 `{ updated }`
- `DELETE /api/remotes/:name` → 200 `{ deleted }`
- `POST /api/remotes/:name/test` → 200 `{ ok: boolean, detail?: string }`
- Errors are mapped to `{ error: string, status: number }` with a matching HTTP status.

**Styling note:** Components use plain, minimal CSS classes. Visual polish is intentionally deferred (the user will refine with the frontend-design skill later). Keep markup clean and class-based so restyling is easy.

**This plan delivers:** a Vite dev app (`npm --workspace web run dev`) that, against a running backend, lists remotes and creates/edits/tests/deletes them through the wizard — with a component test suite (`npm --workspace web run test`) that mocks the API client and verifies behavior without a backend.

---

## File structure introduced by this plan

```
web/
  package.json
  tsconfig.json
  vite.config.ts                # React plugin, dev proxy /api -> :3000, vitest config
  index.html
  src/
    main.tsx                    # React root + router
    App.tsx                     # AuthGate wrapper + AppShell + routes
    styles.css                  # minimal base styles
    test/setup.ts               # jest-dom matchers
    api/
      types.ts                  # RcOption, RcProvider, RemoteSummary, ConfigOut (mirror server)
      client.ts                 # typed fetch wrapper + endpoint functions
    hooks/
      useProviders.ts           # load providers (once)
      useRemotes.ts             # load + refresh remotes
    components/
      AppShell.tsx              # sidebar nav + content area
      AuthGate.tsx              # status check, login form, unprotected banner
      Tooltip.tsx               # small ⓘ tooltip
      OptionField.tsx           # render one RcOption as a control
      RemoteCard.tsx            # one remote in the dashboard
      ConfirmDialog.tsx         # simple confirm modal
    pages/
      RemotesPage.tsx           # dashboard: list + actions + wizard host
      SettingsPage.tsx          # stub (version UI added in Plan 3)
    wizard/
      optionVisibility.ts       # pure helpers: which options show, control kind
      RemoteWizard.tsx          # 4-step add/edit wizard + pending/continue flow
```

---

## Task 1: Web workspace scaffold

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/test/setup.ts`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "@rclone-gui/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.1",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: `web/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `web/vite.config.ts`**

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>rclone GUI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `web/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: `web/src/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #111; }
.app { display: flex; min-height: 100vh; }
.sidebar { width: 200px; background: #0f172a; color: #cbd5e1; padding: 14px 0; }
.sidebar .brand { padding: 0 16px 14px; font-weight: 700; color: #fff; }
.sidebar a, .sidebar .navitem { display: block; padding: 8px 16px; color: #cbd5e1; text-decoration: none; }
.sidebar a.active { background: #1e293b; color: #fff; border-left: 3px solid #2563eb; }
.sidebar .navitem.disabled { color: #64748b; cursor: default; }
.content { flex: 1; padding: 20px; }
.banner { background: #fef3c7; border: 1px solid #f59e0b; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
.btn { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn.secondary { background: #e5e7eb; color: #111; }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 13px; margin-bottom: 3px; }
.field .hint { color: #6b7280; font-size: 11px; }
.field input, .field select { width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; }
.tooltip { position: relative; cursor: help; color: #6b7280; }
.tooltip .tip { display: none; position: absolute; left: 16px; top: -2px; z-index: 10; background: #111; color: #fff; padding: 6px 8px; border-radius: 4px; width: 240px; font-size: 12px; }
.tooltip:hover .tip { display: block; }
.required { color: #ef4444; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 8px; padding: 18px; width: 520px; max-height: 86vh; overflow: auto; }
.steps { display: flex; gap: 6px; margin-bottom: 12px; font-size: 12px; }
.steps .step { background: #e5e7eb; padding: 3px 9px; border-radius: 12px; }
.steps .step.active { background: #2563eb; color: #fff; }
.status-ok { color: #16a34a; }
.status-untested { color: #d97706; }
.status-error { color: #ef4444; }
.error-text { color: #ef4444; font-size: 13px; }
```

- [ ] **Step 7: `web/src/App.tsx`** (placeholder for this task; replaced in Task 5)

```tsx
export default function App() {
  return <div className="app">rclone GUI</div>;
}
```

- [ ] **Step 8: `web/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Write the failing test `web/src/App.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App.js";

test("App renders the brand text", () => {
  render(<App />);
  expect(screen.getByText("rclone GUI")).toBeInTheDocument();
});
```

- [ ] **Step 10: Install and run**

Run from repo root:
```bash
npm install
npm --workspace web run test
```
Expected: 1 passing test.

- [ ] **Step 11: Commit**

```bash
git add package-lock.json web/
git commit -m "feat(web): scaffold Vite React app with Vitest + RTL"
```

---

## Task 2: API types and typed client

**Files:**
- Create: `web/src/api/types.ts`, `web/src/api/client.ts`
- Test: `web/src/api/client.test.ts`

- [ ] **Step 1: `web/src/api/types.ts`** (mirror of the server types the UI consumes)

```ts
export interface RcOptionExample {
  Value: string;
  Help: string;
  Provider?: string;
}

export interface RcOption {
  Name: string;
  Help: string;
  Groups?: string;
  Provider?: string;
  Default: unknown;
  DefaultStr: string;
  Type: string;
  Examples?: RcOptionExample[];
  Hide: number;
  Required: boolean;
  IsPassword: boolean;
  Advanced: boolean;
  Exclusive: boolean;
  Sensitive: boolean;
}

export interface RcProvider {
  Name: string;
  Description: string;
  Options: RcOption[];
  Hide: boolean;
}

export interface RemoteSummary {
  name: string;
  type: string;
  parameters: Record<string, string>;
}

export interface ConfigOut {
  State?: string;
  Option?: RcOption & { Value?: unknown };
  Error?: string;
  Result?: string;
}

export interface AuthStatus {
  protected: boolean;
  authenticated: boolean;
}

export interface TestResult {
  ok: boolean;
  detail?: string;
}

/** Result of create/continue: either done (name set) or a pending interactive step. */
export interface ConfigStep {
  created?: string;
  pending?: ConfigOut;
}
```

- [ ] **Step 2: `web/src/api/client.ts`**

```ts
import type {
  AuthStatus,
  ConfigStep,
  RcProvider,
  RemoteSummary,
  TestResult,
} from "./types.js";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body: unknown = text.length ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed: ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  login: (password: string) =>
    request<{ authenticated: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  providers: () => request<{ providers: RcProvider[] }>("/api/providers").then((r) => r.providers),
  remotes: () => request<{ remotes: RemoteSummary[] }>("/api/remotes").then((r) => r.remotes),
  createRemote: (name: string, type: string, parameters: Record<string, string>) =>
    request<ConfigStep>("/api/remotes", {
      method: "POST",
      body: JSON.stringify({ name, type, parameters }),
    }),
  continueRemote: (name: string, state: string, result: string) =>
    request<ConfigStep>(`/api/remotes/${encodeURIComponent(name)}/continue`, {
      method: "POST",
      body: JSON.stringify({ state, result }),
    }),
  updateRemote: (name: string, parameters: Record<string, string>) =>
    request<{ updated: string }>(`/api/remotes/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ parameters }),
    }),
  deleteRemote: (name: string) =>
    request<{ deleted: string }>(`/api/remotes/${encodeURIComponent(name)}`, { method: "DELETE" }),
  testRemote: (name: string) =>
    request<TestResult>(`/api/remotes/${encodeURIComponent(name)}/test`, { method: "POST" }),
};

export type Api = typeof api;
```

- [ ] **Step 2: Write the failing test `web/src/api/client.test.ts`**

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError, api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

test("remotes() unwraps the remotes array", async () => {
  mockFetch(200, { remotes: [{ name: "a", type: "local", parameters: {} }] });
  const out = await api.remotes();
  expect(out).toEqual([{ name: "a", type: "local", parameters: {} }]);
});

test("non-2xx throws ApiError with the server error message and status", async () => {
  mockFetch(400, { error: "invalid remote name", status: 400 });
  await expect(api.createRemote("bad name", "local", {})).rejects.toMatchObject({
    name: "ApiError",
    message: "invalid remote name",
    status: 400,
  });
  void ApiError;
});

test("createRemote posts name/type/parameters as JSON", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ created: "x" }), { status: 201 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.createRemote("x", "s3", { provider: "AWS" });
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({ name: "x", type: "s3", parameters: { provider: "AWS" } });
});
```

- [ ] **Step 3: Run the test**

Run: `npm --workspace web run test client`
Expected: 3 passing tests.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/
git commit -m "feat(web): typed API client + shared types"
```

---

## Task 3: Tooltip and OptionField

The core of the spec: render any rclone option as the correct control with its tooltip and default.

**Files:**
- Create: `web/src/components/Tooltip.tsx`, `web/src/wizard/optionVisibility.ts`, `web/src/components/OptionField.tsx`
- Test: `web/src/wizard/optionVisibility.test.ts`, `web/src/components/OptionField.test.tsx`

- [ ] **Step 1: `web/src/components/Tooltip.tsx`**

```tsx
export function Tooltip({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="tooltip" aria-label={text} role="img">
      {" ⓘ"}
      <span className="tip">{text}</span>
    </span>
  );
}
```

- [ ] **Step 2: `web/src/wizard/optionVisibility.ts`** (pure helpers — heavily tested)

```ts
import type { RcOption } from "../api/types.js";

export type ControlKind = "bool" | "select" | "suggest" | "password" | "number" | "text";

const NUMERIC = new Set(["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64"]);

/** Decide which input control an option should render as. */
export function controlKind(o: RcOption): ControlKind {
  if (o.IsPassword || o.Sensitive) return "password";
  if (o.Type === "bool") return "bool";
  if (o.Examples && o.Examples.length > 0) return o.Exclusive ? "select" : "suggest";
  if (NUMERIC.has(o.Type)) return "number";
  return "text";
}

/** Hidden options (Hide !== 0) are never shown. */
export function isVisible(o: RcOption, providerValue: string | undefined): boolean {
  if (o.Hide !== 0) return false;
  return matchesProvider(o, providerValue);
}

/**
 * Provider filtering: an option with a Provider filter only applies to certain
 * provider sub-types. rclone's convention: a comma-separated list, optionally
 * negated with a leading "!". Empty filter => applies to all.
 */
export function matchesProvider(o: RcOption, providerValue: string | undefined): boolean {
  const filter = o.Provider ?? "";
  if (filter === "") return true;
  if (!providerValue) return true; // no provider chosen yet => don't hide
  let negate = false;
  let list = filter;
  if (list.startsWith("!")) { negate = true; list = list.slice(1); }
  const set = list.split(",").map((s) => s.trim()).filter(Boolean);
  const included = set.includes(providerValue);
  return negate ? !included : included;
}

/** Split visible options into basic and advanced, applying provider filtering. */
export function partitionOptions(
  options: RcOption[],
  providerValue: string | undefined,
): { basic: RcOption[]; advanced: RcOption[] } {
  const visible = options.filter((o) => isVisible(o, providerValue));
  return {
    basic: visible.filter((o) => !o.Advanced),
    advanced: visible.filter((o) => o.Advanced),
  };
}
```

- [ ] **Step 3: Write the failing test `web/src/wizard/optionVisibility.test.ts`**

```ts
import { expect, test } from "vitest";
import { controlKind, matchesProvider, partitionOptions } from "./optionVisibility.js";
import type { RcOption } from "../api/types.js";

function opt(p: Partial<RcOption>): RcOption {
  return {
    Name: "x", Help: "", Default: "", DefaultStr: "", Type: "string",
    Hide: 0, Required: false, IsPassword: false, Advanced: false,
    Exclusive: false, Sensitive: false, ...p,
  };
}

test("controlKind maps types and flags", () => {
  expect(controlKind(opt({ Type: "bool" }))).toBe("bool");
  expect(controlKind(opt({ IsPassword: true }))).toBe("password");
  expect(controlKind(opt({ Sensitive: true }))).toBe("password");
  expect(controlKind(opt({ Type: "int" }))).toBe("number");
  expect(controlKind(opt({ Examples: [{ Value: "a", Help: "" }], Exclusive: true }))).toBe("select");
  expect(controlKind(opt({ Examples: [{ Value: "a", Help: "" }], Exclusive: false }))).toBe("suggest");
  expect(controlKind(opt({ Type: "string" }))).toBe("text");
});

test("matchesProvider handles include, negate, and empty filters", () => {
  expect(matchesProvider(opt({ Provider: "" }), "AWS")).toBe(true);
  expect(matchesProvider(opt({ Provider: "AWS,Minio" }), "AWS")).toBe(true);
  expect(matchesProvider(opt({ Provider: "AWS,Minio" }), "Ceph")).toBe(false);
  expect(matchesProvider(opt({ Provider: "!AWS" }), "AWS")).toBe(false);
  expect(matchesProvider(opt({ Provider: "!AWS" }), "Ceph")).toBe(true);
  expect(matchesProvider(opt({ Provider: "AWS" }), undefined)).toBe(true);
});

test("partitionOptions splits basic/advanced and drops hidden", () => {
  const { basic, advanced } = partitionOptions(
    [opt({ Name: "a" }), opt({ Name: "b", Advanced: true }), opt({ Name: "c", Hide: 1 })],
    undefined,
  );
  expect(basic.map((o) => o.Name)).toEqual(["a"]);
  expect(advanced.map((o) => o.Name)).toEqual(["b"]);
});
```

- [ ] **Step 4: `web/src/components/OptionField.tsx`**

```tsx
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
```

- [ ] **Step 5: Write the failing test `web/src/components/OptionField.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { OptionField } from "./OptionField.js";
import type { RcOption } from "../api/types.js";

function opt(p: Partial<RcOption>): RcOption {
  return {
    Name: "access_key_id", Help: "AWS Access Key ID.", Default: "", DefaultStr: "",
    Type: "string", Hide: 0, Required: false, IsPassword: false, Advanced: false,
    Exclusive: false, Sensitive: false, ...p,
  };
}

test("renders label, required marker, tooltip and default hint", () => {
  render(<OptionField option={opt({ Required: true, DefaultStr: "us-east-1", Help: "The region." })} value="" onChange={() => {}} />);
  expect(screen.getByText("access_key_id")).toBeInTheDocument();
  expect(screen.getByText("*")).toBeInTheDocument();
  expect(screen.getByText(/default: us-east-1/)).toBeInTheDocument();
  expect(screen.getByLabelText("The region.")).toBeInTheDocument(); // tooltip
});

test("password option renders a masked input", () => {
  const { container } = render(<OptionField option={opt({ IsPassword: true })} value="" onChange={() => {}} />);
  expect(container.querySelector('input[type="password"]')).toBeTruthy();
});

test("text input reports changes", async () => {
  const onChange = vi.fn();
  render(<OptionField option={opt({})} value="" onChange={onChange} />);
  await userEvent.type(screen.getByLabelText(/access_key_id/), "AKIA");
  expect(onChange).toHaveBeenCalled();
});

test("exclusive examples render a select", () => {
  render(<OptionField option={opt({ Exclusive: true, Examples: [{ Value: "us-east-1", Help: "US East" }] })} value="" onChange={() => {}} />);
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /us-east-1/ })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the tests**

Run: `npm --workspace web run test optionVisibility OptionField`
Expected: optionVisibility (3 tests) + OptionField (4 tests) all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Tooltip.tsx web/src/wizard/optionVisibility.ts web/src/components/OptionField.tsx web/src/wizard/optionVisibility.test.ts web/src/components/OptionField.test.tsx
git commit -m "feat(web): OptionField + option visibility/control-kind helpers"
```

---

## Task 4: Data hooks

**Files:**
- Create: `web/src/hooks/useProviders.ts`, `web/src/hooks/useRemotes.ts`
- Test: `web/src/hooks/useRemotes.test.tsx`

- [ ] **Step 1: `web/src/hooks/useProviders.ts`**

```ts
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { RcProvider } from "../api/types.js";

export function useProviders() {
  const [providers, setProviders] = useState<RcProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .providers()
      .then((p) => { if (alive) setProviders(p); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  return { providers, error, loading: providers === null && error === null };
}
```

- [ ] **Step 2: `web/src/hooks/useRemotes.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { RemoteSummary } from "../api/types.js";

export function useRemotes() {
  const [remotes, setRemotes] = useState<RemoteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRemotes(await api.remotes());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { remotes, error, loading, refresh };
}
```

- [ ] **Step 3: Write the failing test `web/src/hooks/useRemotes.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRemotes } from "./useRemotes.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { remotes, loading } = useRemotes();
  if (loading) return <div>loading</div>;
  return <ul>{remotes.map((r) => <li key={r.name}>{r.name}</li>)}</ul>;
}

test("useRemotes loads remotes from the api", async () => {
  vi.spyOn(api, "remotes").mockResolvedValue([
    { name: "gdrive", type: "drive", parameters: {} },
  ]);
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("gdrive")).toBeInTheDocument());
});
```

- [ ] **Step 4: Run the test**

Run: `npm --workspace web run test useRemotes`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/
git commit -m "feat(web): useProviders and useRemotes hooks"
```

---

## Task 5: App shell, routing, and auth gate

**Files:**
- Create: `web/src/components/AppShell.tsx`, `web/src/components/AuthGate.tsx`, `web/src/pages/SettingsPage.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/components/AuthGate.test.tsx`

- [ ] **Step 1: `web/src/components/AppShell.tsx`**

```tsx
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const SOON = ["Browse", "Jobs", "Mounts", "Schedules"];

export function AppShell({ unprotected, children }: { unprotected: boolean; children: ReactNode }) {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">⛅ rclone GUI</div>
        <NavLink to="/" className={({ isActive }) => (isActive ? "active" : "")}>📁 Remotes</NavLink>
        {SOON.map((s) => (
          <span key={s} className="navitem disabled">{s} · soon</span>
        ))}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>⚙ Settings</NavLink>
      </nav>
      <main className="content">
        {unprotected ? (
          <div className="banner" role="alert">⚠ Running unprotected — set GUI_PASSWORD to require login.</div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: `web/src/components/AuthGate.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client.js";
import type { AuthStatus } from "../api/types.js";

export function AuthGate({ children }: { children: (status: AuthStatus) => ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.authStatus().then(setStatus).catch((e: Error) => setError(e.message));
  useEffect(() => { void refresh(); }, []);

  if (error) return <div className="content"><p className="error-text">{error}</p></div>;
  if (!status) return <div className="content">Loading…</div>;

  if (status.protected && !status.authenticated) {
    return (
      <div className="content">
        <h2>Sign in</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.login(password);
              await refresh();
              setError(null);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn" type="submit">Log in</button>
        </form>
      </div>
    );
  }

  return <>{children(status)}</>;
}
```

- [ ] **Step 3: `web/src/pages/SettingsPage.tsx`** (stub; version UI added in Plan 3)

```tsx
export function SettingsPage() {
  return (
    <div>
      <h2>Settings</h2>
      <p className="hint">rclone version management and update controls arrive in a later step.</p>
    </div>
  );
}
```

- [ ] **Step 4: REPLACE `web/src/App.tsx`**

```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { AuthGate } from "./components/AuthGate.js";
import { RemotesPage } from "./pages/RemotesPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        {(status) => (
          <AppShell unprotected={!status.protected}>
            <Routes>
              <Route path="/" element={<RemotesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </AppShell>
        )}
      </AuthGate>
    </BrowserRouter>
  );
}
```

NOTE: `RemotesPage` is created in Task 6. To keep this task's build green, create a minimal placeholder `web/src/pages/RemotesPage.tsx` now and flesh it out in Task 6:

```tsx
export function RemotesPage() {
  return <div><h2>Remotes</h2></div>;
}
```

- [ ] **Step 5: Update `web/src/App.test.tsx`** (the brand text moved into the shell; the app now calls the API on mount, so mock it)

Replace `web/src/App.test.tsx` with:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App.js";
import { api } from "./api/client.js";

afterEach(() => vi.restoreAllMocks());

test("renders the shell and unprotected banner when auth is off", async () => {
  vi.spyOn(api, "authStatus").mockResolvedValue({ protected: false, authenticated: true });
  vi.spyOn(api, "remotes").mockResolvedValue([]);
  render(<App />);
  await waitFor(() => expect(screen.getByText("⛅ rclone GUI")).toBeInTheDocument());
  expect(screen.getByRole("alert")).toHaveTextContent(/Running unprotected/);
});
```

- [ ] **Step 6: Write the failing test `web/src/components/AuthGate.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "./AuthGate.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("shows login when protected and unauthenticated, then renders children after login", async () => {
  const statusSpy = vi.spyOn(api, "authStatus")
    .mockResolvedValueOnce({ protected: true, authenticated: false })
    .mockResolvedValueOnce({ protected: true, authenticated: true });
  vi.spyOn(api, "login").mockResolvedValue({ authenticated: true });

  render(<AuthGate>{() => <div>secret content</div>}</AuthGate>);

  await waitFor(() => expect(screen.getByText("Sign in")).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText("Password"), "hunter2");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));

  await waitFor(() => expect(screen.getByText("secret content")).toBeInTheDocument());
  expect(statusSpy).toHaveBeenCalledTimes(2);
});

test("renders children directly when unprotected", async () => {
  vi.spyOn(api, "authStatus").mockResolvedValue({ protected: false, authenticated: true });
  render(<AuthGate>{() => <div>open content</div>}</AuthGate>);
  await waitFor(() => expect(screen.getByText("open content")).toBeInTheDocument());
});
```

- [ ] **Step 7: Run the tests**

Run: `npm --workspace web run test App AuthGate`
Expected: App (1) + AuthGate (2) pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/AppShell.tsx web/src/components/AuthGate.tsx web/src/pages/ web/src/App.tsx web/src/App.test.tsx web/src/components/AuthGate.test.tsx
git commit -m "feat(web): app shell, routing, and optional-auth gate"
```

---

## Task 6: Remotes dashboard with card actions

**Files:**
- Create: `web/src/components/RemoteCard.tsx`, `web/src/components/ConfirmDialog.tsx`
- Modify: `web/src/pages/RemotesPage.tsx`
- Test: `web/src/pages/RemotesPage.test.tsx`

- [ ] **Step 1: `web/src/components/ConfirmDialog.tsx`**

```tsx
export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <p>{message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `web/src/components/RemoteCard.tsx`**

```tsx
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
      <div className="hint">{remote.type}</div>
      {detail ? <div className="error-text">{detail}</div> : null}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn secondary" onClick={() => onEdit(remote.name)}>Edit</button>
        <button className="btn secondary" onClick={test}>Test</button>
        <button className="btn secondary" onClick={() => onDelete(remote.name)}>Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: REPLACE `web/src/pages/RemotesPage.tsx`**

```tsx
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
```

- [ ] **Step 4: Write the failing test `web/src/pages/RemotesPage.test.tsx`**

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RemotesPage } from "./RemotesPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("lists remotes and deletes one after confirmation", async () => {
  vi.spyOn(api, "remotes")
    .mockResolvedValueOnce([{ name: "gdrive", type: "drive", parameters: {} }])
    .mockResolvedValueOnce([]);
  const del = vi.spyOn(api, "deleteRemote").mockResolvedValue({ deleted: "gdrive" });

  render(<RemotesPage />);
  await waitFor(() => expect(screen.getByText("gdrive")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

  await waitFor(() => expect(del).toHaveBeenCalledWith("gdrive"));
  await waitFor(() => expect(screen.queryByText("gdrive")).not.toBeInTheDocument());
});

test("Test button shows ok status", async () => {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "s3", type: "s3", parameters: {} }]);
  vi.spyOn(api, "testRemote").mockResolvedValue({ ok: true });
  render(<RemotesPage />);
  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Test" }));
  await waitFor(() => expect(screen.getByText("● ok")).toBeInTheDocument());
});
```

NOTE: This test imports `RemoteWizard` transitively via `RemotesPage`. `RemoteWizard` is created in Task 7. To keep Task 6 building and testing green, first create a minimal placeholder `web/src/wizard/RemoteWizard.tsx`:

```tsx
import type { RemoteSummary } from "../api/types.js";

export function RemoteWizard(_props: {
  editName?: string;
  existing: RemoteSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  return null;
}
```

Task 7 replaces this placeholder with the real wizard.

- [ ] **Step 5: Run the tests**

Run: `npm --workspace web run test RemotesPage`
Expected: 2 passing tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/RemoteCard.tsx web/src/components/ConfirmDialog.tsx web/src/pages/RemotesPage.tsx web/src/pages/RemotesPage.test.tsx web/src/wizard/RemoteWizard.tsx
git commit -m "feat(web): remotes dashboard with test/delete actions"
```

---

## Task 7: The add/edit remote wizard

Replaces the `RemoteWizard.tsx` placeholder with the full 4-step wizard, including the pending/continue (OAuth) flow.

**Files:**
- Modify: `web/src/wizard/RemoteWizard.tsx`
- Test: `web/src/wizard/RemoteWizard.test.tsx`

- [ ] **Step 1: REPLACE `web/src/wizard/RemoteWizard.tsx`**

```tsx
import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import type { ConfigOut, RcProvider, RemoteSummary } from "../api/types.js";
import { useProviders } from "../hooks/useProviders.js";
import { OptionField } from "../components/OptionField.js";
import { partitionOptions } from "./optionVisibility.js";

type Step = "type" | "basic" | "advanced" | "save";
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
      // Drop empty values so rclone uses its defaults.
      const params = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
      if (editName) {
        await api.updateRemote(editName, params);
        onSaved();
        return;
      }
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
          {(["type", "basic", "advanced", "save"] as Step[]).map((s) => (
            <span key={s} className={`step${s === step ? " active" : ""}`}>{s}</span>
          ))}
        </div>

        {pending ? (
          <PendingStep pending={pending} busy={busy} error={error} onContinue={continueConfig} />
        ) : step === "type" ? (
          <div>
            <input
              className="field"
              placeholder="Search backends…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search backends"
              style={{ width: "100%", padding: 6 }}
            />
            <div style={{ maxHeight: 240, overflow: "auto", margin: "10px 0" }}>
              {(providers ?? [])
                .filter((p) => p.Name.includes(search.toLowerCase()) || p.Description.toLowerCase().includes(search.toLowerCase()))
                .map((p) => (
                  <div key={p.Name} className="field">
                    <label>
                      <input
                        type="radio"
                        name="backend"
                        checked={type === p.Name}
                        onChange={() => setType(p.Name)}
                      />{" "}
                      <b>{p.Name}</b> — <span className="hint">{p.Description}</span>
                    </label>
                  </div>
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
        ) : step === "advanced" ? (
          <div>
            <details>
              <summary>Advanced ({advanced.length})</summary>
              {advanced.map((o) => (
                <OptionField key={o.Name} option={o} value={values[o.Name] ?? ""} onChange={(v) => set(o.Name, v)} />
              ))}
            </details>
            <WizardNav onBack={() => setStep("basic")} backLabel="Back" nextLabel="Review" onNext={() => setStep("save")} />
          </div>
        ) : (
          <div>
            <p>Save remote <b>{name || editName}</b> ({type})?</p>
            {error ? <p className="error-text">{error}</p> : null}
            <WizardNav
              onBack={() => setStep("advanced")}
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

/** Generic interactive step for OAuth/other backends that need a continue loop. */
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
```

- [ ] **Step 2: Write the failing test `web/src/wizard/RemoteWizard.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RemoteWizard } from "./RemoteWizard.js";
import { api } from "../api/client.js";
import type { RcProvider } from "../api/types.js";

afterEach(() => vi.restoreAllMocks());

const s3: RcProvider = {
  Name: "s3",
  Description: "Amazon S3 and compatible",
  Hide: false,
  Options: [
    {
      Name: "access_key_id", Help: "AWS Access Key ID.", Default: "", DefaultStr: "",
      Type: "string", Hide: 0, Required: true, IsPassword: false, Advanced: false,
      Exclusive: false, Sensitive: false,
    },
    {
      Name: "chunk_size", Help: "Chunk size.", Default: "5Mi", DefaultStr: "5Mi",
      Type: "SizeSuffix", Hide: 0, Required: false, IsPassword: false, Advanced: true,
      Exclusive: false, Sensitive: false,
    },
  ],
};

test("create flow: pick backend, name, fill basic, save", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  const create = vi.spyOn(api, "createRemote").mockResolvedValue({ created: "mys3" });
  const onSaved = vi.fn();

  render(<RemoteWizard existing={[]} onClose={() => {}} onSaved={onSaved} />);

  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.type(screen.getByLabelText(/Remote name/), "mys3");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  // basic step
  await userEvent.type(screen.getByLabelText(/access_key_id/), "AKIA123");
  await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
  await userEvent.click(screen.getByRole("button", { name: "Review" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith("mys3", "s3", { access_key_id: "AKIA123" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

test("rejects a duplicate remote name", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  render(<RemoteWizard existing={[{ name: "dup", type: "s3", parameters: {} }]} onClose={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.type(screen.getByLabelText(/Remote name/), "dup");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/already exists/)).toBeInTheDocument();
});

test("pending step drives the continue flow", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  vi.spyOn(api, "createRemote").mockResolvedValue({
    pending: { State: "*oauth", Option: { Name: "config_token", Help: "Paste token", Default: "", DefaultStr: "", Type: "string", Hide: 0, Required: true, IsPassword: false, Advanced: false, Exclusive: false, Sensitive: false } },
  });
  const cont = vi.spyOn(api, "continueRemote").mockResolvedValue({ created: "mys3" });
  const onSaved = vi.fn();

  render(<RemoteWizard existing={[]} onClose={() => {}} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.type(screen.getByLabelText(/Remote name/), "mys3");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
  await userEvent.click(screen.getByRole("button", { name: "Review" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.getByLabelText(/config_token/)).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText(/config_token/), "tok123");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(cont).toHaveBeenCalledWith("mys3", "*oauth", "tok123"));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
```

- [ ] **Step 3: Run the tests**

Run: `npm --workspace web run test RemoteWizard`
Expected: 3 passing tests.

- [ ] **Step 4: Run the full web suite**

Run: `npm --workspace web run test`
Expected: all web tests pass (App, client, optionVisibility, OptionField, useRemotes, AuthGate, RemotesPage, RemoteWizard).

- [ ] **Step 5: Typecheck and build**

Run: `npm --workspace web run build`
Expected: `tsc` passes with no errors and Vite produces `web/dist/`.

- [ ] **Step 6: Commit**

```bash
git add web/src/wizard/RemoteWizard.tsx web/src/wizard/RemoteWizard.test.tsx
git commit -m "feat(web): 4-step add/edit remote wizard with OAuth continue flow"
```

---

## Self-review notes (author check against the spec)

- **Every option with tooltip + default, auto-generated** → `OptionField` + `optionVisibility` render from `RcOption` metadata (`Help`→tooltip, `DefaultStr`→default/placeholder, `Examples`→select/suggest, `IsPassword`/`Sensitive`→masked, numeric types→number, `Required`→marker). Provider-conditional fields via `matchesProvider`.
- **Wizard (Type → Basic → Advanced → Save)** → Task 7, advanced collapsed in a `<details>`.
- **Dashboard with cards, status, edit/test/delete + add** → Tasks 5–6.
- **Optional auth, unprotected banner** → `AuthGate` + `AppShell` (Task 5).
- **OAuth/interactive backends** → generic `PendingStep` + `continueRemote` loop (Task 7).
- **Dev wiring** → Vite proxy `/api`→`:3000` (Task 1). Production static serving is Plan 3.

Deferred to Plan 3 (correctly out of scope): the backend serving `web/dist`, the Dockerfile, the rclone version self-updater and its Settings UI (the `SettingsPage` is a stub here).

## Execution handoff

Self-contained and testable with a mocked API client (no backend needed for `npm --workspace web run test`). For a live check: run the backend (`npm --workspace server run dev` with `RCLONE_BINARY="$(pwd)/.rclone/rclone"`) and `npm --workspace web run dev`, then open the Vite URL.
