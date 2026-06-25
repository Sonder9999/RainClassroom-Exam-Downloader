import { Elysia } from "elysia";
import { downloadLesson, progressClients } from "./downloader";

export const downloadPlugin = new Elysia()
  .post("/api/download/lesson", ({ body }: { body: { classroomId: string; lessonId: string; courseName: string; lessonIndex: number; lessonTitle: string } }) => {
    const { classroomId, lessonId, courseName, lessonIndex, lessonTitle } = body;
    console.log(`[Download] Triggering download for lesson ${lessonId} (${lessonTitle})`);
    
    // Trigger download in background asynchronously
    downloadLesson(classroomId, lessonId, courseName, lessonIndex, lessonTitle).catch(err => {
      console.error(`[Download] Background download failed for lesson ${lessonId}:`, err);
    });

    return { success: true, message: "Download started in background" };
  })
  .ws("/api/download/ws", {
    open(ws) {
      console.log("[WS] Download progress client connected");
      progressClients.add(ws);
    },
    close(ws) {
      console.log("[WS] Download progress client disconnected");
      progressClients.delete(ws);
    }
  });
