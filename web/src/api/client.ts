import type {
  AuthStatus,
  BwLimit,
  ConfigStep,
  DirEntry,
  JobInfo,
  LaunchInput,
  MountInstance,
  RcProvider,
  RemoteSummary,
  Schedule,
  ScheduleInput,
  ServeInstance,
  TestResult,
  VersionStatus,
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
  version: () => request<VersionStatus>("/api/version"),
  updateRclone: () =>
    request<VersionStatus>("/api/version/update", { method: "POST", body: JSON.stringify({}) }),
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
  schedules: () => request<{ schedules: Schedule[] }>("/api/schedules").then((r) => r.schedules),
  createSchedule: (input: ScheduleInput) =>
    request<{ schedule: Schedule }>("/api/schedules", { method: "POST", body: JSON.stringify(input) }).then((r) => r.schedule),
  updateSchedule: (id: string, patch: Partial<ScheduleInput>) =>
    request<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.schedule),
  deleteSchedule: (id: string) =>
    request<{ deleted: string }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runSchedule: (id: string) =>
    request<{ ran: string }>(`/api/schedules/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({}) }),
  bwlimit: () => request<BwLimit>("/api/bwlimit"),
  setBwlimit: (rate: string) =>
    request<BwLimit>("/api/bwlimit", { method: "POST", body: JSON.stringify({ rate }) }),
};

export type Api = typeof api;
