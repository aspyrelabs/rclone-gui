import type { RcClient } from "./client.js";

export interface DirEntry {
  Path: string;
  Name: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
  MimeType: string;
}

/** Join a remote name + path into an rc fs string: `remote:path`. */
export function fsString(remote: string, path: string): string {
  return `${remote}:${path}`;
}

export class BrowseService {
  constructor(private readonly client: RcClient) {}

  /** List one directory level of `remote` at `path` ("" = root). */
  async list(remote: string, path: string): Promise<DirEntry[]> {
    const out = await this.client.call<{ list: DirEntry[] }>("operations/list", {
      fs: fsString(remote, path),
      remote: "",
    });
    return out.list ?? [];
  }

  /** Create directory `name` under `remote`:`parentPath`. */
  async mkdir(remote: string, parentPath: string, name: string): Promise<void> {
    await this.client.call("operations/mkdir", { fs: fsString(remote, parentPath), remote: name });
  }

  /** Delete `name` under `remote`:`parentPath`. Dirs are purged recursively. */
  async deletePath(remote: string, parentPath: string, name: string, isDir: boolean): Promise<void> {
    const rcPath = isDir ? "operations/purge" : "operations/deletefile";
    await this.client.call(rcPath, { fs: fsString(remote, parentPath), remote: name });
  }
}
