import { Elysia } from "elysia";
import { getMockResponse, getAvailableHarCourses } from "./har-parser";
import { loadConfig, updateConfig } from "./config";

/**
 * Elysia plugin managing the offline status toggle and intercepting
 * Rain Classroom API routes when operating in offline mode.
 */
export const offlinePlugin = new Elysia()
  // 1. Get available mock courses list parsed from HAR logs
  .get("/api/offline/courses", async () => {
    const config = await loadConfig();
    const courses = getAvailableHarCourses(config.showArchived);
    console.log(`[Offline] Returning ${courses.length} courses from HAR cache (showArchived: ${config.showArchived})`);
    return courses;
  })

  // 2. Set offline status endpoint
  .post("/api/config/offline", async ({ body }: { body: { offlineMode: boolean } }) => {
    console.log(`[Offline] Received toggle request to: ${body.offlineMode}`);
    const updated = await updateConfig({ offlineMode: body.offlineMode });
    return { success: true, offlineMode: updated.offlineMode };
  })

  // 3. Global onBeforeHandle hook to intercept live APIs and serve mock data when offline
  .onBeforeHandle({ as: "global" }, async ({ request, set }) => {
    const config = await loadConfig();
    if (!config.offlineMode) {
      return; // Online mode: let Elysia proceed to live request routing
    }

    const urlObj = new URL(request.url);
    const pathname = urlObj.pathname;

    // We intercept Rain Classroom API prefix patterns
    const isRainClassroomApi =
      pathname.startsWith("/v2/api/") ||
      pathname.startsWith("/mooc-api/") ||
      pathname.startsWith("/api/v3/") ||
      pathname.startsWith("/api/v2/"); // extra logs api path compatibility

    if (isRainClassroomApi) {
      console.log(`[Offline] Intercepting request: ${request.method} ${urlObj.href}`);
      const mock = getMockResponse(request.method, urlObj.href);
      
      if (mock) {
        set.status = mock.status;
        set.headers["content-type"] = mock.mimeType;
        // Parse and return object if content type is JSON, else return raw string
        if (mock.mimeType.includes("application/json")) {
          try {
            return JSON.parse(mock.text);
          } catch {
            return mock.text;
          }
        }
        return mock.text;
      } else {
        console.warn(`[Offline] No cached entry matches request for: ${request.method} ${pathname}`);
        set.status = 404;
        set.headers["content-type"] = "application/json";
        return { error: "API endpoint mock cache miss in local HAR files" };
      }
    }
  });
