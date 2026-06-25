import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { promises as fs } from "fs";
import { join } from "path";
import { loadConfig, saveConfig, updateConfig, resetConfigCache, Config } from "../src/backend/config";

const TEST_CONFIG_DIR = join(process.cwd(), "config");
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "default.json");

describe("Configuration Manager Tests", () => {
  let backupConfig: string | null = null;

  beforeAll(async () => {
    // Backup existing configuration if any
    try {
      backupConfig = await fs.readFile(TEST_CONFIG_PATH, "utf-8");
    } catch {
      backupConfig = null;
    }
    // Remove local default.json for clean testing
    try {
      await fs.unlink(TEST_CONFIG_PATH);
    } catch {}
    resetConfigCache();
  });

  afterAll(async () => {
    // Restore backup
    if (backupConfig !== null) {
      await fs.writeFile(TEST_CONFIG_PATH, backupConfig, "utf-8");
    } else {
      try {
        await fs.unlink(TEST_CONFIG_PATH);
      } catch {}
    }
    resetConfigCache();
  });

  test("should load default configuration successfully", async () => {
    const config = await loadConfig();
    expect(config).toBeDefined();
    expect(config.port).toBe(3000);
    expect(config.hue).toBe(165);
    expect(config.cookies).toBeDefined();
  });

  test("should update configuration and write to disk", async () => {
    const updated = await updateConfig({ hue: 200, downloadDir: "custom_downloads" });
    expect(updated.hue).toBe(200);
    expect(updated.downloadDir).toBe("custom_downloads");

    // Read directly from file to verify disk write
    const fileContent = await fs.readFile(TEST_CONFIG_PATH, "utf-8");
    const diskConfig = JSON.parse(fileContent) as Config;
    expect(diskConfig.hue).toBe(200);
    expect(diskConfig.downloadDir).toBe("custom_downloads");
  });
});
