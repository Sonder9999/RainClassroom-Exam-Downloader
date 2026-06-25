// DOM Elements
const loginSection = document.getElementById("login-section");
const successSection = document.getElementById("success-section");
const qrImage = document.getElementById("qr-image");
const qrSpinner = document.getElementById("qr-spinner");
const qrMask = document.getElementById("qr-mask");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const btnRelogin = document.getElementById("btn-relogin");

let socket = null;

// Initialize Theme
function initTheme() {
  const currentTheme = localStorage.getItem("theme") || "dark";
  if (currentTheme === "light") {
    document.body.classList.add("light-theme");
    themeIcon.textContent = "☀️";
  } else {
    document.body.classList.remove("light-theme");
    themeIcon.textContent = "🌙";
  }
}

// Toggle Theme Handler
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
  const isLight = document.body.classList.contains("light-theme");
  themeIcon.textContent = isLight ? "☀️" : "🌙";
  localStorage.setItem("theme", isLight ? "light" : "dark");
});

// Update Status Utility
function updateStatus(state, text) {
  statusDot.className = "status-dot"; // reset
  statusDot.classList.add(`status-${state}`);
  statusText.textContent = text;
}

// Setup WebSocket Authentication Proxy Connection
function connectAuthWebSocket() {
  // Clear previous socket if any
  if (socket) {
    socket.close();
  }

  // Show spinner, hide QR image
  qrImage.classList.add("hidden");
  qrSpinner.classList.remove("hidden");
  qrMask.classList.add("hidden");
  updateStatus("pending", "正在建立安全登录通道...");

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/auth/ws`;
  console.log(`[App] Connecting to WebSocket at ${wsUrl}`);
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("[App] WebSocket connection opened");
    updateStatus("scanning", "通道已建立，正在获取微信二维码...");
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[App] WebSocket message received:", data.type);

      if (data.type === "qr") {
        qrSpinner.classList.add("hidden");
        qrImage.src = data.image;
        qrImage.classList.remove("hidden");
        updateStatus("scanning", "微信二维码加载成功，请扫码登录");
      } else if (data.type === "success") {
        updateStatus("success", "扫码登录成功！");
        socket.close();
        
        // Slide out login card, slide in success card
        setTimeout(() => {
          loginSection.classList.add("hidden");
          successSection.classList.remove("hidden");
        }, 800);
      } else if (data.type === "error") {
        updateStatus("error", data.message || "登录错误");
        qrSpinner.classList.add("hidden");
        qrMask.classList.remove("hidden");
      }
    } catch (err) {
      console.error("[App] Error parsing socket message:", err);
    }
  };

  socket.onerror = (err) => {
    console.error("[App] WebSocket connection error:", err);
    updateStatus("error", "连接认证代理服务器失败");
    qrSpinner.classList.add("hidden");
    qrMask.classList.remove("hidden");
  };

  socket.onclose = () => {
    console.log("[App] WebSocket connection closed");
  };
}

// Check Current Session Status
async function checkSession() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const config = await res.json();
      if (config.authenticated) {
        console.log("[App] Session detected. Showing success screen.");
        loginSection.classList.add("hidden");
        successSection.classList.remove("hidden");
      } else {
        console.log("[App] No active session. Launching WebSocket QR Login.");
        loginSection.classList.remove("hidden");
        successSection.classList.add("hidden");
        connectAuthWebSocket();
      }
    }
  } catch (err) {
    console.error("[App] Error checking session status:", err);
    connectAuthWebSocket();
  }
}

// Mask click (Refresh QR)
qrMask.addEventListener("click", () => {
  connectAuthWebSocket();
});

// Re-login button
btnRelogin.addEventListener("click", () => {
  // Clear stored credential sessionid via post/config update later if needed,
  // for now we just show the QR code scanner again
  successSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
  connectAuthWebSocket();
});

// Start application
initTheme();
checkSession();
