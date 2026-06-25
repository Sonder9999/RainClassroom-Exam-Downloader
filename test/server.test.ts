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

  test("should retrieve available courses in offline mode", async () => {
    const res = await app.handle(new Request("http://localhost/api/offline/courses"));
    expect(res.status).toBe(200);
    const courses = await res.json() as any[];
    expect(courses.length).toBeGreaterThan(0);
    expect(courses[0].id).toBeDefined();
    expect(courses[0].name).toBeDefined();
  });

  test("should toggle offlineMode and intercept requests correctly", async () => {
    // 1. Turn on offlineMode
    const toggleOnRes = await app.handle(new Request("http://localhost/api/config/offline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offlineMode: true })
    }));
    expect(toggleOnRes.status).toBe(200);
    
    // 2. Fetch course chapter API - should be intercepted and returned from HAR
    const chapterRes = await app.handle(new Request("http://localhost/mooc-api/v1/lms/learn/course/chapter?classroom_id=29291320"));
    expect(chapterRes.status).toBe(200);
    const chapterData = await chapterRes.json() as any;
    const courseName = chapterData.data?.course_name || chapterData.course_name;
    expect(courseName).toBe("编译原理");

    // 3. Reset offlineMode to false for clean state
    await app.handle(new Request("http://localhost/api/config/offline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offlineMode: false })
    }));
  });
});
