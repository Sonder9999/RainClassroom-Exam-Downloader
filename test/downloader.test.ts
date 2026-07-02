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

  test("should download exam in offline mode", async () => {
    const classroomId = "29287752"; // 计算机图形学
    const lessonId = "4327178";
    const courseName = "计算机图形学";
    const lessonIndex = 1;
    const lessonTitle = "CG-6&7";

    // Run the download process directly with leafType = 5
    await downloadLesson(classroomId, lessonId, courseName, lessonIndex, lessonTitle, 5);

    // Verify md file exists
    const lessonDir = join(process.cwd(), testDownloadDir, courseName, "01_CG-6&7");
    const mdFile = join(lessonDir, "CG-6&7.md");
    const mdExists = await fs.stat(mdFile).then(() => true).catch(() => false);
    expect(mdExists).toBe(true);

    const content = await fs.readFile(mdFile, "utf-8");
    expect(content).toContain("考试详情: CG-6&7");
  });

  test("should download multiple presentations in offline mode without conflict", async () => {
    const classroomId = "29287752";
    const lessonId = "1647680549202234496";
    const courseName = "计算机图形学";
    const lessonIndex = 3;
    const lessonTitle = "计算机图形学 Computer Graphics-0323";

    // Run the download process directly
    await downloadLesson(classroomId, lessonId, courseName, lessonIndex, lessonTitle);

    // Verify multiple presentation subfolders exist
    const lessonDir = join(process.cwd(), testDownloadDir, courseName, "03_计算机图形学 Computer Graphics-0323");
    
    // We expect two subdirectories for presentations:
    // 1. "计算机图形学 Computer Graphics_1647680688570567680"
    // 2. "计算机图形学 Computer Graphics_1647712743136259840"
    const subfolder1 = join(lessonDir, "计算机图形学 Computer Graphics_1647680688570567680");
    const subfolder2 = join(lessonDir, "计算机图形学 Computer Graphics_1647712743136259840");
    
    const subfolder1Exists = await fs.stat(subfolder1).then(() => true).catch(() => false);
    const subfolder2Exists = await fs.stat(subfolder2).then(() => true).catch(() => false);
    
    expect(subfolder1Exists).toBe(true);
    expect(subfolder2Exists).toBe(true);

    // Verify slide files exist in each subfolder
    const files1 = await fs.readdir(subfolder1);
    const files2 = await fs.readdir(subfolder2);
    expect(files1.length).toBeGreaterThan(0);
    expect(files2.length).toBeGreaterThan(0);

    // Verify problems folder and extracted problems exist with pres prefix
    const problemDir = join(process.cwd(), testDownloadDir, courseName, "problem");
    const prob1 = join(problemDir, "03_pres1_01.jpg");
    const prob2 = join(problemDir, "03_pres2_01.jpg");
    const prob1Exists = await fs.stat(prob1).then(() => true).catch(() => false);
    const prob2Exists = await fs.stat(prob2).then(() => true).catch(() => false);

    expect(prob1Exists).toBe(true);
    expect(prob2Exists).toBe(true);
  });
});
