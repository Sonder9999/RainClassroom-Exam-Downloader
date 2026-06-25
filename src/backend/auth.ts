import { updateConfig } from "./config";

/**
 * Interface representing the JSON message sent back to the frontend client
 */
export interface AuthSocketMessage {
  type: "qr" | "success" | "error" | "status";
  image?: string;
  sessionid?: string;
  message?: string;
}

/**
 * Handles the WebSocket login proxy logic.
 * Connects to Rain Classroom WSS, fetches qr tickets, and processes login success.
 */
export function handleAuthWebSocket(ws: any) {
  console.log("[Auth] Frontend client connected to Auth WebSocket");

  let targetWs: WebSocket | null = null;
  let isClosed = false;

  // Cleanup helper
  const cleanup = () => {
    isClosed = true;
    if (targetWs) {
      try {
        console.log("[Auth] Closing connection to Rain Classroom WebSocket server");
        targetWs.close();
      } catch (err) {
        console.error("[Auth] Error closing Rain Classroom WebSocket:", err);
      }
      targetWs = null;
    }
  };

  try {
    // 1. Establish connection to Rain Classroom WebSocket server
    const targetUrl = "wss://www.yuketang.cn/wsapp/";
    console.log(`[Auth] Connecting to Rain Classroom WSS at: ${targetUrl}`);
    targetWs = new WebSocket(targetUrl);

    targetWs.onopen = () => {
      if (isClosed) {
        cleanup();
        return;
      }
      console.log("[Auth] Connected to Rain Classroom WebSocket. Sending requestlogin payload.");
      const loginPayload = {
        op: "requestlogin",
        role: "web",
        version: 1.4,
        type: "qrcode",
        from: "web"
      };
      targetWs?.send(JSON.stringify(loginPayload));
    };

    targetWs.onmessage = async (event) => {
      if (isClosed) return;
      try {
        const payload = JSON.parse(event.data.toString());
        console.log(`[Auth] Received message from Rain Classroom WSS, op: ${payload.op}`);

        if (payload.op === "requestlogin") {
          const ticketUrl = payload.ticket;
          if (!ticketUrl) {
            console.error("[Auth] Request login message did not contain a ticket URL");
            ws.send(JSON.stringify({ type: "error", message: "Failed to obtain QR login ticket" }));
            return;
          }
          console.log(`[Auth] Fetching QR code image from ticket: ${ticketUrl}`);
          
          // Fetch QR code image bytes and convert to Base64
          const res = await fetch(ticketUrl);
          if (!res.ok) {
            throw new Error(`HTTP error fetching ticket: ${res.status}`);
          }
          const buffer = await res.arrayBuffer();
          const base64Image = Buffer.from(buffer).toString("base64");
          
          ws.send(JSON.stringify({
            type: "qr",
            image: `data:image/png;base64,${base64Image}`
          }));
        } else if (payload.op === "loginsuccess") {
          const userId = payload.UserID;
          const auth = payload.Auth;
          if (!userId || !auth) {
            console.error("[Auth] Login success message missing UserID or Auth token");
            ws.send(JSON.stringify({ type: "error", message: "Login failed: credentials missing in response" }));
            return;
          }
          console.log(`[Auth] Scan success! UserID: ${userId}. Performing web login handshake...`);
          
          // Perform web login POST request to get cookies
          const loginRes = await fetch("https://www.yuketang.cn/pc/web_login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            body: JSON.stringify({ UserID: userId, Auth: auth })
          });

          if (!loginRes.ok) {
            throw new Error(`Login handshake failed with status ${loginRes.status}`);
          }

          // Parse cookies from response headers
          const setCookies = loginRes.headers.getSetCookie();
          const cookies: Record<string, string> = {};
          for (const cookieStr of setCookies) {
            const [part] = cookieStr.split(";");
            const [key, val] = part.split("=");
            if (key && val) {
              cookies[key.trim()] = val.trim();
            }
          }

          const sessionid = cookies["sessionid"] || "";
          const csrftoken = cookies["csrftoken"] || "";
          
          if (!sessionid) {
            console.error("[Auth] Handshake response did not set sessionid cookie");
            ws.send(JSON.stringify({ type: "error", message: "Failed to retrieve session ID cookie" }));
            return;
          }

          console.log("[Auth] Successfully retrieved session cookies. Updating configuration...");
          await updateConfig({
            cookies: {
              sessionid,
              csrftoken,
              xtbz: cookies["xtbz"] || "ykt",
              university_id: cookies["university_id"] || "",
              platform_id: cookies["platform_id"] || "3",
              _cf_bm: cookies["_cf_bm"] || ""
            }
          });

          console.log("[Auth] Config updated. Sending success event to frontend client");
          ws.send(JSON.stringify({
            type: "success",
            sessionid
          }));
          cleanup();
        }
      } catch (err: any) {
        console.error("[Auth] Error processing message from Rain Classroom WS:", err);
        ws.send(JSON.stringify({ type: "error", message: err.message || "Internal error during login handshake" }));
        cleanup();
      }
    };

    targetWs.onerror = (err) => {
      console.error("[Auth] Rain Classroom WebSocket error:", err);
      ws.send(JSON.stringify({ type: "error", message: "Rain Classroom connection error" }));
      cleanup();
    };

    targetWs.onclose = () => {
      console.log("[Auth] Rain Classroom WebSocket closed");
      if (!isClosed) {
        ws.send(JSON.stringify({ type: "error", message: "WebSocket connection closed by remote server" }));
        cleanup();
      }
    };

  } catch (err: any) {
    console.error("[Auth] Failed to initialize WebSocket proxy:", err);
    ws.send(JSON.stringify({ type: "error", message: "Failed to initialize login session" }));
    cleanup();
  }

  // Handle client close
  return {
    close() {
      console.log("[Auth] Frontend client disconnected");
      cleanup();
    }
  };
}
