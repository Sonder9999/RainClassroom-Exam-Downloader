// DOM Elements
const loginSection = document.getElementById("login-section");
const successSection = document.getElementById("success-section");
const dashboardSection = document.getElementById("dashboard-section");
const qrImage = document.getElementById("qr-image");
const qrSpinner = document.getElementById("qr-spinner");
const qrMask = document.getElementById("qr-mask");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const btnRelogin = document.getElementById("btn-relogin");

// Offline mode elements
const offlineSwitch = document.getElementById("offline-switch");
const offlineBanner = document.getElementById("offline-banner");
const courseSelect = document.getElementById("course-select");
const chaptersList = document.getElementById("chapters-list");

let socket = null;
let currentOfflineMode = false;

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
  if (socket) {
    socket.close();
  }

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
        
        setTimeout(() => {
          loginSection.classList.add("hidden");
          successSection.classList.remove("hidden");
          checkSession(); // Reload session status to load dashboard
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

// Populate Courses Dropdown
async function loadCourses() {
  try {
    courseSelect.innerHTML = '<option value="">-- 正在读取归档课程 --</option>';
    const res = await fetch("/api/offline/courses");
    if (!res.ok) throw new Error("Failed to fetch HAR courses");
    
    const courses = await res.json();
    courseSelect.innerHTML = '<option value="">-- 请选择课程 --</option>';
    
    if (courses.length === 0) {
      courseSelect.innerHTML = '<option value="">-- 未检测到 HAR 缓存课程 --</option>';
      return;
    }

    courses.forEach(course => {
      const option = document.createElement("option");
      option.value = course.id;
      option.setAttribute("data-sign", course.courseSign);
      option.textContent = course.name;
      courseSelect.appendChild(option);
    });
  } catch (err) {
    console.error("[App] Error loading courses list:", err);
    courseSelect.innerHTML = '<option value="">-- 加载课程列表失败 --</option>';
  }
}

// Leaf Type helpers
function getLeafBadge(type) {
  switch (type) {
    case 8: return "📝 PPT 课件";
    case 9: return "✍️ 作业";
    case 5: return "⏱️ 考试";
    case 7: return "🎥 视频/文档";
    default: return "📄 其他活动";
  }
}

// Render Chapters and Lessons List
async function loadCourseChapters(classroomId, sign) {
  try {
    chaptersList.innerHTML = '<div class="spinner" style="margin: 2rem auto;"></div>';
    
    // Fetch chapters (intercepted by backend if in offline mode)
    const url = `/mooc-api/v1/lms/learn/course/chapter?classroom_id=${classroomId}&course_sign=${sign}&term=latest`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch course chapters");

    const payload = await res.json();
    const chapters = payload.data?.course_chapter || [];

    // Pre-calculate sequential slide lesson indices (leaf_type === 8)
    let pptIndex = 0;
    chapters.forEach(chap => {
      const leaves = chap.section_leaf_list || [];
      leaves.forEach(leaf => {
        if (leaf.leaf_type === 8) {
          pptIndex++;
          leaf.lessonIndex = pptIndex;
        }
      });
    });
    
    chaptersList.innerHTML = "";
    if (chapters.length === 0) {
      chaptersList.innerHTML = '<div class="placeholder-text">该课程暂无章节大纲数据</div>';
      return;
    }

    chapters.forEach(chapter => {
      const chapDiv = document.createElement("div");
      chapDiv.className = "chapter-item";
      
      const title = document.createElement("div");
      title.className = "chapter-title";
      title.textContent = chapter.name || "未分类教学活动";
      chapDiv.appendChild(title);

      const lessonsDiv = document.createElement("div");
      lessonsDiv.className = "lessons-list";

      const leaves = chapter.section_leaf_list || [];
      leaves.forEach(leaf => {
        const lessonItem = document.createElement("div");
        lessonItem.className = "lesson-item";

        const nameSpan = document.createElement("span");
        nameSpan.className = "lesson-name";
        nameSpan.textContent = leaf.name;

        const metaDiv = document.createElement("div");
        metaDiv.className = "lesson-meta";

        const dateStr = leaf.start_time ? new Date(leaf.start_time).toLocaleDateString("zh-CN") : "";
        metaDiv.textContent = `${getLeafBadge(leaf.leaf_type)} ${dateStr ? `| ${dateStr}` : ""}`;

        // If PPT slide, add download button
        if (leaf.leaf_type === 8 && leaf.lessonIndex !== undefined) {
          const dlBtn = document.createElement("button");
          dlBtn.className = "btn btn-sm btn-download";
          dlBtn.textContent = "下载课件";
          dlBtn.onclick = (e) => {
            e.stopPropagation();
            const courseName = courseSelect.selectedOptions[0].textContent;
            triggerLessonDownload(classroomId, leaf.id, courseName, leaf.lessonIndex, leaf.name);
          };
          metaDiv.appendChild(dlBtn);
        }

        lessonItem.appendChild(nameSpan);
        lessonItem.appendChild(metaDiv);
        lessonsDiv.appendChild(lessonItem);
      });

      chapDiv.appendChild(lessonsDiv);
      chaptersList.appendChild(chapDiv);
    });
  } catch (err) {
    console.error("[App] Error loading chapters:", err);
    chaptersList.innerHTML = '<div class="placeholder-text" style="color: var(--error);">加载大纲数据失败</div>';
  }
}

// Course selection change handler
courseSelect.addEventListener("change", () => {
  const classroomId = courseSelect.value;
  if (!classroomId) {
    chaptersList.innerHTML = '<div class="placeholder-text">请先选择一门课程以展示大纲</div>';
    return;
  }
  const option = courseSelect.selectedOptions[0];
  const sign = option.getAttribute("data-sign") || "";
  loadCourseChapters(classroomId, sign);
});

// Check Current Session Status
async function checkSession() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const config = await res.json();
      currentOfflineMode = config.offlineMode;
      offlineSwitch.checked = currentOfflineMode;
      offlineBanner.classList.toggle("hidden", !currentOfflineMode);

      // Populate settings fields
      document.getElementById("setting-download-dir").value = config.downloadDir || "downloads";
      document.getElementById("setting-concurrency").value = config.concurrency || 5;
      document.getElementById("setting-show-archived").checked = !!config.showArchived;

      if (currentOfflineMode) {
        console.log("[App] Operating in offline mode. Showing mock course dashboard.");
        loginSection.classList.add("hidden");
        successSection.classList.add("hidden");
        dashboardSection.classList.remove("hidden");
        loadCourses();
      } else {
        if (config.authenticated) {
          console.log("[App] Session detected in online mode.");
          loginSection.classList.add("hidden");
          successSection.classList.remove("hidden");
          dashboardSection.classList.remove("hidden");
          loadCourses();
        } else {
          console.log("[App] No session in online mode. Loading WeChat WS QR scanner.");
          loginSection.classList.remove("hidden");
          successSection.classList.add("hidden");
          dashboardSection.classList.add("hidden");
          connectAuthWebSocket();
        }
      }
    }
  } catch (err) {
    console.error("[App] Error loading application config:", err);
    connectAuthWebSocket();
  }
}

// Offline Switch Change Handler
offlineSwitch.addEventListener("change", async (e) => {
  const checked = e.target.checked;
  console.log(`[App] Offline mode toggled to: ${checked}`);
  try {
    const res = await fetch("/api/config/offline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offlineMode: checked })
    });
    if (res.ok) {
      checkSession();
    }
  } catch (err) {
    console.error("[App] Failed to update offline mode configuration on server:", err);
    offlineSwitch.checked = !checked; // revert
  }
});

// Mask click (Refresh QR)
qrMask.addEventListener("click", () => {
  connectAuthWebSocket();
});

// Re-login button
btnRelogin.addEventListener("click", () => {
  successSection.classList.add("hidden");
  dashboardSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
  connectAuthWebSocket();
});

// Dashboard Tabs Switch Handler
const tabConsole = document.getElementById("tab-console");
const tabSettings = document.getElementById("tab-settings");
const consoleTabContent = document.getElementById("console-tab-content");
const settingsTabContent = document.getElementById("settings-tab-content");

tabConsole.addEventListener("click", () => {
  tabConsole.classList.add("active");
  tabSettings.classList.remove("active");
  consoleTabContent.classList.remove("hidden");
  settingsTabContent.classList.add("hidden");
});

tabSettings.addEventListener("click", () => {
  tabSettings.classList.add("active");
  tabConsole.classList.remove("active");
  settingsTabContent.classList.remove("hidden");
  consoleTabContent.classList.add("hidden");
});

// Label click helper for show-archived switch
const settingShowArchivedLabel = document.getElementById("setting-show-archived-label");
const settingShowArchived = document.getElementById("setting-show-archived");
settingShowArchivedLabel.addEventListener("click", (e) => {
  if (e.target !== settingShowArchived) {
    settingShowArchived.checked = !settingShowArchived.checked;
  }
});

// Save settings button handler
const btnSaveSettings = document.getElementById("btn-save-settings");
btnSaveSettings.addEventListener("click", async () => {
  const downloadDir = document.getElementById("setting-download-dir").value.trim();
  const concurrency = parseInt(document.getElementById("setting-concurrency").value) || 5;
  const showArchived = document.getElementById("setting-show-archived").checked;

  try {
    btnSaveSettings.textContent = "正在保存...";
    btnSaveSettings.disabled = true;
    
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        downloadDir,
        concurrency,
        showArchived
      })
    });
    if (res.ok) {
      console.log("[App] Settings saved successfully");
      // Reload courses list
      await loadCourses();
      alert("配置参数已成功保存！");
    } else {
      alert("保存设置失败，请稍后重试。");
    }
  } catch (err) {
    console.error("[App] Error saving settings:", err);
    alert("保存设置时发生网络错误。");
  } finally {
    btnSaveSettings.textContent = "保存自定义设置";
    btnSaveSettings.disabled = false;
  }
});

// Modal and Download logic
const progressModal = document.getElementById("progress-modal");
const modalTitle = document.getElementById("modal-title");
const modalProgressBar = document.getElementById("modal-progress-bar");
const modalPercent = document.getElementById("modal-percent");
const modalSpeed = document.getElementById("modal-speed");
const modalStatusText = document.getElementById("modal-status-text");
const btnCloseModal = document.getElementById("btn-close-modal");

let activeDownloadLessonId = null;

// Initialize WebSocket progress subscriber connection
let downloadSocket = null;
function connectDownloadWebSocket() {
  if (downloadSocket && downloadSocket.readyState === WebSocket.OPEN) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/download/ws`;
  console.log(`[App] Connecting download WebSocket to ${wsUrl}`);
  
  downloadSocket = new WebSocket(wsUrl);
  downloadSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "download_progress" && data.lessonId === activeDownloadLessonId) {
        updateProgressUI(data);
      }
    } catch (err) {
      console.error("[App] Error parsing download WS message:", err);
    }
  };
  
  downloadSocket.onclose = () => {
    console.log("[App] Download WebSocket closed. Reconnecting in 3s...");
    setTimeout(connectDownloadWebSocket, 3000);
  };
}

function updateProgressUI(data) {
  modalProgressBar.style.width = `${data.percent}%`;
  modalPercent.textContent = `${data.percent}%`;
  modalSpeed.textContent = data.speed;

  switch (data.status) {
    case "pending":
      modalStatusText.textContent = "正在连接雨课堂 API 准备幻灯片树...";
      break;
    case "downloading":
      modalStatusText.textContent = "正在多线程并发下载幻灯片及提取测试题...";
      break;
    case "completed":
      modalStatusText.textContent = "✓ 课件及题库下载提取成功！文件已保存在指定的下载目录。";
      modalProgressBar.style.width = "100%";
      modalPercent.textContent = "100%";
      modalSpeed.textContent = "0 KB/s";
      btnCloseModal.classList.remove("hidden");
      break;
    case "failed":
      modalStatusText.textContent = "❌ 下载失败！请检查您的网络连接或 cookie 是否过期。";
      btnCloseModal.classList.remove("hidden");
      break;
  }
}

async function triggerLessonDownload(classroomId, lessonId, courseName, lessonIndex, lessonTitle) {
  activeDownloadLessonId = lessonId;
  
  // Setup modal starting UI state
  modalTitle.textContent = `正在下载：${lessonTitle}`;
  modalProgressBar.style.width = "0%";
  modalPercent.textContent = "0%";
  modalSpeed.textContent = "0 KB/s";
  modalStatusText.textContent = "正在提交下载任务到队列...";
  btnCloseModal.classList.add("hidden");
  progressModal.classList.remove("hidden");

  // Ensure WebSocket is active
  connectDownloadWebSocket();

  // POST trigger request
  try {
    const res = await fetch("/api/download/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classroomId,
        lessonId,
        courseName,
        lessonIndex,
        lessonTitle
      })
    });
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("[App] Trigger download error:", err);
    updateProgressUI({
      lessonId,
      percent: 0,
      speed: "0 KB/s",
      status: "failed"
    });
  }
}

btnCloseModal.addEventListener("click", () => {
  progressModal.classList.add("hidden");
  activeDownloadLessonId = null;
});

// Start application
initTheme();
checkSession();
connectDownloadWebSocket();
