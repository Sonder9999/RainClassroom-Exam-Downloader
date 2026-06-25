import { expect, test, describe, beforeAll } from "bun:test";
import { initHarIndex, getMockResponse, getAvailableHarCourses } from "../src/backend/har-parser";

describe("HAR Parser & Mock API Tests", () => {
  beforeAll(async () => {
    // Load and index the local HAR files
    await initHarIndex();
  });

  test("should parse and load courses from available HAR files", () => {
    const courses = getAvailableHarCourses();
    expect(courses).toBeDefined();
    // Since we have docs/*.har, it should detect at least '编译原理' or '自然语言处理'
    expect(courses.length).toBeGreaterThan(0);
    
    const courseNames = courses.map(c => c.name);
    expect(courseNames.some(name => name.includes("编译") || name.includes("图形") || name.includes("语言"))).toBe(true);
  });

  test("should retrieve mock response from index for valid API keys", () => {
    // Let's search mock data for 编译原理 chapters
    // Path: /mooc-api/v1/lms/learn/course/chapter?classroom_id=29291320 (class ID for 编译原理)
    const url = "https://www.yuketang.cn/mooc-api/v1/lms/learn/course/chapter?classroom_id=29291320";
    const res = getMockResponse("GET", url);
    
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    
    const data = JSON.parse(res!.text);
    expect(data.course_name || data.data?.course_name).toBe("编译原理");
  });
});
