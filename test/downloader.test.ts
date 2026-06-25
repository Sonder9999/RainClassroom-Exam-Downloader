import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { promises as fs } from "fs";
import { join } from "path";
import { downloadLesson } from "../src/backend/downloader";
import { updateConfig, resetConfigCache } from "../src/backend/config";
import { app } from "../src/index";

describe("Downloader Queue and Problem Extraction Tests", () => {
  const testDownloadDir = "test_downloads";

  beforeAll(async () => {
    resetConfigCache();
    await updateConfig({
      offlineMode: true,
      downloadDir: testDownloadDir,
      concurrency: 3
    });
  });

  afterAll(async () => {
    // Clean up test_downloads folder
    try {
      await fs.rm(join(process.cwd(), testDownloadDir), { recursive: true, force: true });
    } catch {}
    resetConfigCache();
  });

  test("should download slides and extract problems in offline mode", async () => {
    const classroomId = "29291320"; // 编译原理
    const lessonId = "1689657328074605440";
    const courseName = "编译原理";
    const lessonIndex = 11;
    const lessonTitle = "第5章（2）";

    // Run the download process directly
    await downloadLesson(classroomId, lessonId, courseName, lessonIndex, lessonTitle);

    // Verify slide files exist
    const lessonDir = join(process.cwd(), testDownloadDir, courseName, "11_第5章（2）");
    const slide1 = join(lessonDir, "001.jpg"); // First slide index is 1
    const slideExists = await fs.stat(slide1).then(() => true).catch(() => false);
    expect(slideExists).toBe(true);

    // Verify problems folder and extracted problem exists
    const problemDir = join(process.cwd(), testDownloadDir, courseName, "problem");
    const problemFile = join(problemDir, "11_01.jpg");
    const problemExists = await fs.stat(problemFile).then(() => true).catch(() => false);
    expect(problemExists).toBe(true);
    
    // Check that we can hit the triggering HTTP endpoint too
    const res = await app.handle(new Request("http://localhost/api/download/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classroomId,
        lessonId,
        courseName,
        lessonIndex,
        lessonTitle
      })
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
