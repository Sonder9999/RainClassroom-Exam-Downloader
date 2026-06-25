import { promises as fs } from "fs";
import { join } from "path";

export interface Cookies {
  sessionid: string;
  csrftoken: string;
  xtbz: string;
  university_id: string;
  platform_id: string;
  _cf_bm?: string;
}

export interface Config {
  port: number;
  hue: number;
  downloadDir: string;
  concurrency: number;
  offlineMode: boolean;
  yuketangUrl: string;
  yuketangWsUrl: string;
  cookies: Cookies;
}

const CONFIG_PATH = join(process.cwd(), "config", "default.json");
const CONFIG_TEMPLATE_PATH = join(process.cwd(), "config", "default.example.json");

let cachedConfig: Config | null = null;

/**
 * Loads the configuration file from disk.
 * If cachedConfig exists, returns the cached version.
 */
export async function loadConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8");
    cachedConfig = JSON.parse(data) as Config;
    console.log("[Config] Loaded configuration successfully");
    return cachedConfig;
  } catch (error) {
    console.warn("[Config] default.json not found or invalid. Loading default.example.json...");
    try {
      const templateData = await fs.readFile(CONFIG_TEMPLATE_PATH, "utf-8");
      const config = JSON.parse(templateData) as Config;
      cachedConfig = config;
      // Copy it to CONFIG_PATH for future runs
      await saveConfig(config);
      console.log("[Config] Initialized config/default.json from template");
      return cachedConfig;
    } catch (templateError) {
      console.error("[Config] Error loading template configuration, using default skeleton:", templateError);
      const defaultConfig: Config = {
        port: 3000,
        hue: 165,
        downloadDir: "downloads",
        concurrency: 5,
        offlineMode: false,
        yuketangUrl: "https://www.yuketang.cn",
        yuketangWsUrl: "wss://www.yuketang.cn/wsapp/",
        cookies: {
          sessionid: "",
          csrftoken: "",
          xtbz: "ykt",
          university_id: "",
          platform_id: "3"
        }
      };
      cachedConfig = defaultConfig;
      return defaultConfig;
    }
  }
}

/**
 * Saves the configuration to disk.
 */
export async function saveConfig(config: Config): Promise<void> {
  cachedConfig = config;
  try {
    const dir = join(process.cwd(), "config");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    console.log("[Config] Saved configuration successfully");
  } catch (error) {
    console.error("[Config] Error saving configuration:", error);
    throw error;
  }
}

/**
 * Updates a portion of the configuration.
 */
export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const current = await loadConfig();
  const updated = {
    ...current,
    ...updates,
    cookies: {
      ...current.cookies,
      ...(updates.cookies || {})
    }
  };
  await saveConfig(updated);
  return updated;
}

/**
 * Resets the in-memory cached configuration (used primarily in tests).
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

