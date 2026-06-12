import path from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  guiPassword: string | null;
  rcloneConfigPath: string;
  rcloneBinary: string | null; // explicit override; null => auto-resolve
  configDir: string;
  webRoot: string | null; // directory of built SPA assets; null disables static serving
  fetchScriptPath: string; // path to scripts/fetch-rclone.sh used by the updater
  schedulesPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = env.RCLONE_GUI_CONFIG_DIR ?? "/config";
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    guiPassword: env.GUI_PASSWORD && env.GUI_PASSWORD.length > 0 ? env.GUI_PASSWORD : null,
    rcloneConfigPath: env.RCLONE_CONFIG ?? path.join(configDir, "rclone.conf"),
    rcloneBinary: env.RCLONE_BINARY ?? null,
    configDir,
    webRoot: env.WEB_ROOT ?? null,
    fetchScriptPath: env.RCLONE_FETCH_SCRIPT ?? "scripts/fetch-rclone.sh",
    schedulesPath: env.SCHEDULES_PATH ?? path.join(configDir, "schedules.json"),
  };
}
