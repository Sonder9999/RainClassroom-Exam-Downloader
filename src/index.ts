import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { loadConfig } from "./backend/config";
import { handleAuthWebSocket } from "./backend/auth";
import { initHarIndex } from "./backend/har-parser";
import { offlinePlugin } from "./backend/offline-routes";

// Initialize HAR mock entries
await initHarIndex();

const config = await loadConfig();

export const app = new Elysia()
  // 1. Serve static frontend assets from src/frontend
  .use(
    staticPlugin({
      assets: "src/frontend",
      prefix: "/"
    })
  )
  .use(offlinePlugin)
  // 2. Serve main single page application at root
  .get("/", () => Bun.file("src/frontend/index.html"))
  // 3. Expose configuration metadata endpoint
  .get("/api/config", async () => {
    const activeConfig = await loadConfig();
    return {
      hue: activeConfig.hue,
      offlineMode: activeConfig.offlineMode,
      authenticated: !!activeConfig.cookies.sessionid
    };
  })
  // 4. WebSocket route proxying WeChat QR authentication
  .ws("/api/auth/ws", {
    open(ws) {
      console.log("[Server] Auth WebSocket connection opened from client");
      const handler = handleAuthWebSocket(ws);
      // Store the handler on ws data context for cleanup
      ws.data = { handler };
    },
    close(ws) {
      console.log("[Server] Auth WebSocket connection closed from client");
      const sessionData = ws.data as { handler?: { close?: () => void } };
      if (sessionData && sessionData.handler && typeof sessionData.handler.close === "function") {
        sessionData.handler.close();
      }
    }
  })
  // 5. Start listening on the configured port
  .listen(config.port);

console.log(`[Server] Rain Classroom Downloader server is running at http://localhost:${config.port}`);
