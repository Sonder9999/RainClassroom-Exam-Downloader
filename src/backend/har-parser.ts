import { promises as fs } from "fs";
import { join, relative } from "path";

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
const cachedCourses = new Set<{ id: string; name: string; courseSign: string; term: string }>();

/**
 * Recursively retrieves all .har files in a directory.
 */
async function getHarFilesRecursive(dir: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
      const filePath = join(dir, file.name);
      if (file.isDirectory()) {
        results = results.concat(await getHarFilesRecursive(filePath));
      } else if (file.name.endsWith(".har")) {
        results.push(filePath);
      }
    }
  } catch (err) {
    // Directory might not exist or error reading
  }
  return results;
}

/**
 * Scans the docs/ directory and loads all .har files into memory.
 */
export async function initHarIndex(): Promise<void> {
  console.log(`[HAR] Starting HAR files scanning in directory: ${HAR_DIR}`);
  harPathnameIndex.clear();
  cachedCourses.clear();

  try {
    const harFiles = await getHarFilesRecursive(HAR_DIR);
    console.log(`[HAR] Found ${harFiles.length} HAR files:`, harFiles.map(f => relative(HAR_DIR, f)));

    const seenCourses = new Map<string, { id: string; name: string; courseSign: string; term: string }>();

    for (const filePath of harFiles) {
      const fileRelativePath = relative(HAR_DIR, filePath);
      console.log(`[HAR] Parsing file: ${fileRelativePath}`);
      
      const fileData = await fs.readFile(filePath, "utf-8");
      const har: HarJson = JSON.parse(fileData);
      
      if (!har.log || !har.log.entries) {
        console.warn(`[HAR] Invalid HAR structure in file: ${fileRelativePath}`);
        continue;
      }


      let entriesCount = 0;
      for (const entry of har.log.entries) {
        const urlStr = entry.request.url;
        // Only index requests targeting yuketang or xuetangx
        if (!urlStr.includes("yuketang.cn") && !urlStr.includes("xuetangx.com")) {
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

        if (pathname.includes("/mooc-api/v1/lms/learn/course/chapter")) {
          try {
            const classroomId = urlObj.searchParams.get("classroom_id") || urlObj.searchParams.get("cid") || "";
            const courseSign = urlObj.searchParams.get("course_sign") || urlObj.searchParams.get("sign") || "";
            const term = urlObj.searchParams.get("term") || "latest";
            
            const payload = JSON.parse(text);
            const courseName = payload.data?.course_name || payload.data?.name || "";
            
            if (classroomId && courseName) {
              seenCourses.set(classroomId, { id: classroomId, name: courseName, courseSign, term });
            }
          } catch {}
        }
      }
      console.log(`[HAR] Successfully indexed ${entriesCount} entries from ${fileRelativePath}`);
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
    const keysToMatch = ["classroom_id", "cid", "lesson_id", "exam_id", "presentation_id", "presentationId"];

    // Find first entry matching query key parameters
    for (const entry of entries) {
      let isMatch = true;
      for (const key of keysToMatch) {
        const reqVal = urlObj.searchParams.get(key);
        // Normalize alias for classroom_id / cid, and presentation_id / presentationId
        let cachedVal = entry.queryParams[key];
        if (key === "classroom_id" || key === "cid") {
          cachedVal = entry.queryParams["classroom_id"] || entry.queryParams["cid"];
        } else if (key === "presentation_id" || key === "presentationId") {
          cachedVal = entry.queryParams["presentation_id"] || entry.queryParams["presentationId"];
        }

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
 * Returns all detected courses from the parsed HAR files, optionally filtering by active semesters.
 */
export function getAvailableHarCourses(showArchived: boolean = false) {
  const allCourses = Array.from(cachedCourses);
  if (showArchived) {
    return allCourses;
  }
  // Term 202502 represents the active ongoing Spring 2026 term.
  // We keep courses belonging to "latest" or "202502"
  return allCourses.filter(c => c.term === "latest" || c.term === "202502");
}
