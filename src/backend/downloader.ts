import { promises as fs } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { getMockResponse } from "./har-parser";

// 1x1 transparent/black pixel JPEG base64 fallback for offline mode
const MOCK_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64"
);

export function cleanFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

// WebSocket progress clients Set
export const progressClients = new Set<any>();

export function broadcastProgress(
  lessonId: string,
  percent: number,
  speed: string,
  status: "pending" | "downloading" | "completed" | "failed"
) {
  const payload = JSON.stringify({
    type: "download_progress",
    lessonId,
    percent,
    speed,
    status
  });
  for (const client of progressClients) {
    try {
      client.send(payload);
    } catch {
      progressClients.delete(client);
    }
  }
}

async function fetchFromYuketang(urlStr: string): Promise<any> {
  const config = await loadConfig();
  if (config.offlineMode) {
    const mock = getMockResponse("GET", urlStr);
    if (!mock) {
      throw new Error(`Offline cache miss for YuKeTang URL: ${urlStr}`);
    }
    return JSON.parse(mock.text);
  }

  const cookies = config.cookies;
  const cookieHeader = [
    `sessionid=${cookies.sessionid}`,
    `csrftoken=${cookies.csrftoken}`,
    `xtbz=${cookies.xtbz}`,
    `university_id=${cookies.university_id}`,
    `platform_id=${cookies.platform_id}`
  ];
  if (cookies._cf_bm) {
    cookieHeader.push(`_cf_bm=${cookies._cf_bm}`);
  }

  const res = await fetch(urlStr, {
    method: "GET",
    headers: {
      "cookie": cookieHeader.join("; "),
      "x-csrftoken": cookies.csrftoken,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "referer": "https://www.yuketang.cn/"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch from YuKeTang, status: ${res.status}`);
  }
  return await res.json();
}

async function resolveLessonId(
  classroomId: string,
  leafId: string,
  leafTitle: string,
  leafType: number
): Promise<string> {
  const config = await loadConfig();
  
  if (leafType === 8) {
    try {
      const logsUrl = `https://www.yuketang.cn/v2/api/web/logs/learn/${classroomId}?actype=14&page=0&offset=100&sort=-1`;
      const logsData = await fetchFromYuketang(logsUrl);
      const activities = logsData.data?.activities || [];
      const match = activities.find((act: any) => 
        act.type === 14 && 
        (act.title === leafTitle || act.title?.trim() === leafTitle.trim())
      );
      if (match) {
        console.log(`[Downloader] Resolved leaf ${leafId} (${leafTitle}) to lessonId ${match.courseware_id} via logs`);
        return String(match.courseware_id);
      }
    } catch (err) {
      console.warn(`[Downloader] Failed to resolve lessonId via logs for leaf ${leafId}:`, err);
    }
  } else if (leafType === 5 || leafType === 9) {
    try {
      const logsUrl = `https://www.yuketang.cn/v2/api/web/logs/learn/${classroomId}?actype=-1&page=0&offset=100&sort=-1`;
      const logsData = await fetchFromYuketang(logsUrl);
      const activities = logsData.data?.activities || [];
      const targetTypes = leafType === 5 ? [5] : [4, 9, 2];
      const match = activities.find((act: any) => 
        targetTypes.includes(act.type) && 
        (act.title === leafTitle || act.title?.trim() === leafTitle.trim())
      );
      if (match) {
        console.log(`[Downloader] Resolved exam/homework leaf ${leafId} (${leafTitle}) to courseware_id ${match.courseware_id} via logs`);
        return String(match.courseware_id);
      }
    } catch (err) {
      console.warn(`[Downloader] Failed to resolve exam/homework ID via logs for leaf ${leafId}:`, err);
    }
  }
  return leafId;
}

export async function downloadLesson(
  classroomId: string,
  lessonId: string,
  courseName: string,
  lessonIndex: number,
  lessonTitle: string,
  leafType: number = 8
): Promise<void> {
  broadcastProgress(lessonId, 0, "0 KB/s", "pending");

  try {
    const config = await loadConfig();
    const resolvedLessonId = await resolveLessonId(classroomId, lessonId, lessonTitle, leafType);

    if (leafType === 5 || leafType === 9) {
      const cleanCourse = cleanFilename(courseName);
      const cleanTitle = cleanFilename(lessonTitle);
      const targetDir = join(process.cwd(), config.downloadDir, cleanCourse, `${String(lessonIndex).padStart(2, "0")}_${cleanTitle}`);
      await fs.mkdir(targetDir, { recursive: true });

      let coverData: any = null;
      let logsMatch: any = null;

      try {
        const logsUrl = `https://www.yuketang.cn/v2/api/web/logs/learn/${classroomId}?actype=-1&page=0&offset=100&sort=-1`;
        const logsData = await fetchFromYuketang(logsUrl);
        const activities = logsData.data?.activities || [];
        const targetTypes = leafType === 5 ? [5] : [4, 9, 2];
        logsMatch = activities.find((act: any) => 
          targetTypes.includes(act.type) && 
          (act.title === lessonTitle || act.title?.trim() === lessonTitle.trim())
        );
      } catch (err) {
        console.warn(`[Downloader] Failed to fetch logs for cover/attachment resolution:`, err);
      }

      try {
        const coverUrl = `https://www.yuketang.cn/v/exam/cover?exam_id=${resolvedLessonId}&classroom_id=${classroomId}`;
        coverData = await fetchFromYuketang(coverUrl);
      } catch (err) {
        console.warn(`[Downloader] Failed to fetch exam cover data:`, err);
      }

      const title = coverData?.data?.title || logsMatch?.title || lessonTitle;
      const totalScore = coverData?.data?.total_score ?? logsMatch?.total_score ?? "未知";
      const problemCount = coverData?.data?.problem_count ?? logsMatch?.problem_count ?? "未知";
      const deadline = coverData?.data?.deadline 
        ? new Date(coverData.data.deadline).toLocaleString("zh-CN") 
        : (logsMatch?.deadline ? new Date(logsMatch.deadline).toLocaleString("zh-CN") : "无");
      const score = coverData?.data?.result?.score ?? logsMatch?.score ?? "未批改/未提交";
      const desc = coverData?.data?.description || "无描述";

      const attachments = logsMatch?.attachments || [];
      const downloadedFiles: string[] = [];
      if (attachments && attachments.length > 0) {
        broadcastProgress(lessonId, 30, "0 KB/s", "downloading");
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          const attUrl = att.url || att.link;
          const attName = att.name || `attachment_${i + 1}`;
          if (attUrl) {
            try {
              const cleanAttName = cleanFilename(attName);
              const destPath = join(targetDir, cleanAttName);
              if (config.offlineMode) {
                await fs.writeFile(destPath, `Offline mock content for attachment: ${attName}`);
              } else {
                const attRes = await fetch(attUrl);
                if (attRes.ok) {
                  const attBuf = Buffer.from(await attRes.arrayBuffer());
                  await fs.writeFile(destPath, attBuf);
                  downloadedFiles.push(cleanAttName);
                }
              }
            } catch (err) {
              console.error(`[Downloader] Failed to download attachment ${attName}:`, err);
            }
          }
        }
      }

      const mdLines = [
        `# ${leafType === 5 ? "考试" : "作业"}详情: ${title}`,
        "",
        `- **课程名称**: ${courseName}`,
        `- **截止日期**: ${deadline}`,
        `- **总分**: ${totalScore}`,
        `- **题目数量**: ${problemCount}`,
        `- **我的得分**: ${score}`,
        `- **描述信息**: ${desc}`,
        ""
      ];

      if (downloadedFiles.length > 0) {
        mdLines.push("## 下载的附件");
        downloadedFiles.forEach(file => {
          mdLines.push(`- [${file}](./${encodeURIComponent(file)})`);
        });
        mdLines.push("");
      }

      const mdPath = join(targetDir, `${cleanTitle}.md`);
      await fs.writeFile(mdPath, mdLines.join("\n"), "utf-8");
      console.log(`[Downloader] Exam/Homework saved to ${mdPath}`);

      broadcastProgress(lessonId, 100, "0 KB/s", "completed");
      return;
    }

    const cleanCourse = cleanFilename(courseName);
    const cleanTitle = cleanFilename(lessonTitle);
    
    const courseDir = join(process.cwd(), config.downloadDir, cleanCourse);
    const lessonDir = join(courseDir, `${String(lessonIndex).padStart(2, "0")}_${cleanTitle}`);
    const problemDir = join(courseDir, "problem");
    
    await fs.mkdir(lessonDir, { recursive: true });
    await fs.mkdir(problemDir, { recursive: true });

    let reviewData: any;
    if (config.offlineMode) {
      try {
        const reviewsDir = join(process.cwd(), "docs", "reviews", courseName);
        const files = await fs.readdir(reviewsDir);
        let match = files.find(file => file.endsWith(`_${resolvedLessonId}.json`));
        if (!match) {
          const prefix = `${String(lessonIndex).padStart(2, "0")}_`;
          match = files.find(file => file.startsWith(prefix));
        }
        if (!match) {
          const cleanTitlePart = cleanFilename(lessonTitle);
          match = files.find(file => file.includes(cleanTitlePart));
        }
        if (match) {
          const fileData = await fs.readFile(join(reviewsDir, match), "utf-8");
          reviewData = JSON.parse(fileData);
          console.log(`[Offline Downloader] Loaded timeline from offline review file: ${match}`);
        } else {
          throw new Error("No matching file");
        }
      } catch (err) {
        console.warn(`[Offline Downloader] Offline review file search failed for ${courseName} (lessonId: ${resolvedLessonId}), falling back to HAR:`, err);
        const reviewUrl = `https://www.yuketang.cn/api/v3/classroom-report/student/review?lesson_id=${resolvedLessonId}`;
        reviewData = await fetchFromYuketang(reviewUrl);
      }
    } else {
      const reviewUrl = `https://www.yuketang.cn/api/v3/classroom-report/student/review?lesson_id=${resolvedLessonId}`;
      reviewData = await fetchFromYuketang(reviewUrl);
    }
    const timeline = reviewData.data?.timelineList || [];

    // Group and de-duplicate slides by index
    const slidesMap = new Map<number, { cover: string; hasProblem: boolean }>();
    for (const item of timeline) {
      if (item.type === "slide") {
        const idx = item.index;
        const cover = item.cover;
        if (idx !== undefined && cover) {
          slidesMap.set(idx, { cover, hasProblem: !!item.hasProblem });
        }
      }
    }

    if (slidesMap.size === 0) {
      console.warn(`[Downloader] Lesson ${lessonId} has no slides.`);
      broadcastProgress(lessonId, 100, "0 KB/s", "completed");
      return;
    }

    const sortedIndices = Array.from(slidesMap.keys()).sort((a, b) => a - b);
    const totalSlides = sortedIndices.length;

    // Filter problems and sort them to get sequential numbering
    const problemSlides = sortedIndices
      .filter(idx => slidesMap.get(idx)!.hasProblem)
      .map((idx, pIdx) => ({
        slideIndex: idx,
        cover: slidesMap.get(idx)!.cover,
        problemNumber: pIdx + 1
      }));

    broadcastProgress(lessonId, 0, "0 KB/s", "downloading");

    let completedCount = 0;
    let totalBytes = 0;
    const startTime = Date.now();

    // Map each slide index to a task
    const tasks = sortedIndices.map(sIdx => async () => {
      const slide = slidesMap.get(sIdx)!;
      const slideFileName = join(lessonDir, `${String(sIdx).padStart(3, "0")}.jpg`);
      
      let alreadyExists = false;
      try {
        const stat = await fs.stat(slideFileName);
        if (stat.size > 0) {
          alreadyExists = true;
          totalBytes += stat.size;
        }
      } catch {}

      let imgBuffer: Buffer | null = null;
      if (!alreadyExists) {
        if (config.offlineMode) {
          imgBuffer = MOCK_JPEG;
        } else {
          const imgRes = await fetch(slide.cover, {
            headers: {
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          });
          if (!imgRes.ok) {
            throw new Error(`Failed to download slide image from ${slide.cover}`);
          }
          imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        }
        await fs.writeFile(slideFileName, imgBuffer);
        totalBytes += imgBuffer.length;
      }

      // If it is a problem slide, copy/save it to the problem folder
      const pSlide = problemSlides.find(p => p.slideIndex === sIdx);
      if (pSlide) {
        const problemFileName = join(problemDir, `${String(lessonIndex).padStart(2, "0")}_${String(pSlide.problemNumber).padStart(2, "0")}.jpg`);
        let pAlreadyExists = false;
        try {
          const stat = await fs.stat(problemFileName);
          if (stat.size > 0) {
            pAlreadyExists = true;
          }
        } catch {}

        if (!pAlreadyExists) {
          if (alreadyExists) {
            await fs.copyFile(slideFileName, problemFileName);
          } else if (imgBuffer) {
            await fs.writeFile(problemFileName, imgBuffer);
          }
        }
      }

      completedCount++;
      const elapsedSec = (Date.now() - startTime) / 1000 || 0.1;
      const rawSpeed = (totalBytes / 1024) / elapsedSec; // KB/s
      const speedStr = rawSpeed > 1024 
        ? `${(rawSpeed / 1024).toFixed(1)} MB/s` 
        : `${rawSpeed.toFixed(0)} KB/s`;
      
      const percent = Math.round((completedCount / totalSlides) * 100);
      broadcastProgress(lessonId, percent, speedStr, "downloading");
    });

    // Run tasks with concurrency limit
    const concurrencyLimit = config.concurrency || 5;
    await runWithConcurrency(tasks, concurrencyLimit);

    broadcastProgress(lessonId, 100, "0 KB/s", "completed");
  } catch (err: any) {
    console.error(`[Downloader] Failed to download lesson ${lessonId}:`, err);
    broadcastProgress(lessonId, 0, "0 KB/s", "failed");
    throw err;
  }
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (err) {
        console.error(`[Concurrency] Task ${currentIndex} failed:`, err);
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}
