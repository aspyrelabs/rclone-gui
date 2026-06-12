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

export interface VersionStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

export interface DirEntry {
  Path: string;
  Name: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
  MimeType: string;
}

export type JobType = "copy" | "move";

export interface PathRef {
  remote: string;
  path: string;
  name: string;
}

export interface LaunchInput {
  type: JobType;
  isDir: boolean;
  src: PathRef;
  dst: PathRef;
}

export interface JobInfo {
  id: number;
  type: JobType;
  src: string;
  dst: string;
  finished: boolean;
  success: boolean;
  error: string;
  bytes: number;
  totalBytes: number;
  transfers: number;
  totalTransfers: number;
  speed: number;
  eta: number | null;
}

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

export interface SchedulePathRef {
  remote: string;
  path: string;
  name: string;
}

export interface Schedule {
  id: string;
  name: string;
  type: "copy" | "move";
  isDir: boolean;
  src: SchedulePathRef;
  dst: SchedulePathRef;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  lastJobId?: number;
  lastError?: string;
  history?: RunRecord[];
}

export type ScheduleInput = Omit<Schedule, "id" | "lastRun" | "lastJobId" | "lastError" | "history">;

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
