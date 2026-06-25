import { promises as fs } from "fs";
import { join } from "path";

export interface HarEntry {
  request: {
    method: string;
    url: string;
  };
  response: {
    status: number;
    content: {
      text?: string;
      mimeType?: string;
      encoding?: string;
    };
  };
}

export interface HarJson {
  log: {
    entries: HarEntry[];
  };
}

interface CachedResponse {
  status: number;
  mimeType: string;
  text: string;
  queryParams: Record<string, string>;
}

const HAR_DIR = join(process.cwd(), "docs");

// In-memory request-response index: pathname -> array of cached entries
const harPathnameIndex = new Map<string, CachedResponse[]>();

// List of indexed courses parsed from classrooms or logs
const cachedCourses = new Set<{ id: string; name: string; courseSign: string }>();

/**
 * Scans the docs/ directory and loads all .har files into memory.
 */
export async function initHarIndex(): Promise<void> {
  console.log(`[HAR] Starting HAR files scanning in directory: ${HAR_DIR}`);
  harPathnameIndex.clear();
  cachedCourses.clear();

  try {
    const files = await fs.readdir(HAR_DIR);
    const harFiles = files.filter(f => f.endsWith(".har"));
    console.log(`[HAR] Found ${harFiles.length} HAR files:`, harFiles);

    const seenCourses = new Map<string, { id: string; name: string; courseSign: string }>();

    for (const file of harFiles) {
      const filePath = join(HAR_DIR, file);
      console.log(`[HAR] Parsing file: ${file}`);
      
      const fileData = await fs.readFile(filePath, "utf-8");
      const har: HarJson = JSON.parse(fileData);
      
      if (!har.log || !har.log.entries) {
        console.warn(`[HAR] Invalid HAR structure in file: ${file}`);
        continue;
      }

      let entriesCount = 0;
      for (const entry of har.log.entries) {
        const urlStr = entry.request.url;
        // Only index requests targeting yuketang
        if (!urlStr.includes("yuketang.cn")) {
          continue;
        }

        let urlObj: URL;
        try {
          urlObj = new URL(urlStr);
        } catch {
          continue;
        }

        const pathname = urlObj.pathname;
        const queryParams: Record<string, string> = {};
        urlObj.searchParams.forEach((val, key) => {
          queryParams[key] = val;
        });

        let text = entry.response.content.text || "";
        if (entry.response.content.encoding === "base64" && text) {
          text = Buffer.from(text, "base64").toString("utf-8");
        }

        const status = entry.response.status;
        const mimeType = entry.response.content.mimeType || "application/json";

        const entryList = harPathnameIndex.get(pathname) || [];
        entryList.push({ status, mimeType, text, queryParams });
        harPathnameIndex.set(pathname, entryList);
        entriesCount++;

        // Extract Course metadata if we encounter course chapters
        if (pathname.includes("/mooc-api/v1/lms/learn/course/chapter")) {
          try {
            const classroomId = urlObj.searchParams.get("classroom_id") || urlObj.searchParams.get("cid") || "";
            const courseSign = urlObj.searchParams.get("course_sign") || urlObj.searchParams.get("sign") || "";
            
            const payload = JSON.parse(text);
            const courseName = payload.data?.course_name || payload.data?.name || "";
            
            if (classroomId && courseName) {
              seenCourses.set(classroomId, { id: classroomId, name: courseName, courseSign });
            }
          } catch {}
        }
      }
      console.log(`[HAR] Successfully indexed ${entriesCount} entries from ${file}`);
    }

    // Populate unique courses
    seenCourses.forEach(course => cachedCourses.add(course));
    
    console.log(`[HAR] Total unique mock pathnames cached: ${harPathnameIndex.size}`);
    console.log(`[HAR] Detected courses:`, Array.from(cachedCourses));
  } catch (err) {
    console.error("[HAR] Error initializing HAR index:", err);
  }
}

/**
 * Returns a cached response from the HAR index matching key query parameters.
 */
export function getMockResponse(method: string, urlStr: string): { status: number; mimeType: string; text: string } | null {
  try {
    let urlObj: URL;
    if (urlStr.startsWith("http")) {
      urlObj = new URL(urlStr);
    } else {
      urlObj = new URL(urlStr, "https://www.yuketang.cn");
    }

    const pathname = urlObj.pathname;
    const entries = harPathnameIndex.get(pathname);
    if (!entries || entries.length === 0) {
      console.log(`[HAR] Mock Cache MISS for pathname: ${pathname}`);
      return null;
    }

    // Key parameters to compare
    const keysToMatch = ["classroom_id", "cid", "lesson_id", "exam_id"];

    // Find first entry matching query key parameters
    for (const entry of entries) {
      let isMatch = true;
      for (const key of keysToMatch) {
        const reqVal = urlObj.searchParams.get(key);
        // Normalize alias for classroom_id / cid
        let cachedVal = entry.queryParams[key];
        if (!cachedVal && key === "classroom_id") cachedVal = entry.queryParams["cid"];
        if (!cachedVal && key === "cid") cachedVal = entry.queryParams["classroom_id"];

        if (reqVal && cachedVal && reqVal !== cachedVal) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        console.log(`[HAR] Mock Cache HIT for path: ${pathname} matching identifiers`);
        return entry;
      }
    }

    // Fallback: return the first matched pathname entry if no exact parameter match
    console.log(`[HAR] Mock Cache Fallback HIT for path: ${pathname}`);
    return entries[0];
  } catch (err) {
    console.error(`[HAR] Error matching mock response:`, err);
    return null;
  }
}

/**
 * Returns all detected courses from the parsed HAR files.
 */
export function getAvailableHarCourses() {
  return Array.from(cachedCourses);
}
