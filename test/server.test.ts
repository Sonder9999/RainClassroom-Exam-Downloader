import { expect, test, describe } from "bun:test";
import { app } from "../src/index";

describe("Elysia Server Endpoint Tests", () => {
  test("should retrieve /api/config with active configurations", async () => {
    const res = await app.handle(new Request("http://localhost/api/config"));
    expect(res.status).toBe(200);
    
    const data = await res.json() as { hue: number; offlineMode: boolean; authenticated: boolean };
    expect(data.hue).toBeDefined();
    expect(data.offlineMode).toBeDefined();
    expect(data.authenticated).toBeDefined();
  });

  test("should serve index.html at root path", async () => {
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    
    const htmlText = await res.text();
    expect(htmlText).toContain("雨课堂下载器");
  });
});
