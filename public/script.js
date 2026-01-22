const socket = io({
  transports: ["websocket", "polling"],
  upgrade: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
});

/* ========================================
   PWA SERVICE WORKER REGISTRATION
   ======================================== */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("✅ Service Worker registered successfully:", registration.scope);
      })
      .catch((error) => {
        console.error("❌ Service Worker registration failed:", error);
      });
  });
}

/* ========================================
   PWA AUTO-UPDATE HANDLER
   ======================================== */

if ("serviceWorker" in navigator) {
  setInterval(() => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) {
        console.log("🔄 Checking for PWA updates...");
        reg.update();
      }
    });
  }, 10 * 60 * 1000);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    console.log("✅ New version available! Reloading...");
    showPopup("App updated! Reloading...", true);
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  });
}

/* ========================================
   ONE-CLICK PWA INSTALL
   ======================================== */

let deferredPrompt;
const installBtn = document.getElementById("installBtn");

// Always show install button
if (installBtn) {
  installBtn.style.display = "block";
}

// Check if already installed
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || 
                     window.navigator.standalone || 
                     document.referrer.includes('android-app://');

if (isStandalone) {
  console.log("📱 Already running as PWA");
  if (installBtn) {
    installBtn.style.display = "none";
  }
}

// Capture install prompt
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log("💾 PWA install prompt ready");
  
  if (installBtn) {
    installBtn.style.display = "block";
  }
});

// One-click install handler
if (installBtn) {
  installBtn.onclick = async () => {
    if (deferredPrompt) {
      // Direct install - no popup
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === "accepted") {
        showPopup("Installing app...");
        installBtn.style.display = "none";
      }
      
      deferredPrompt = null;
    } else {
      // If no prompt available, just show quick message
      showPopup("Open browser menu to install", false);
    }
  };
}

// Track successful installation
window.addEventListener("appinstalled", () => {
  console.log("✅ OyeSwap PWA installed successfully!");
  showPopup("App installed successfully!");
  if (installBtn) {
    installBtn.style.display = "none";
  }
});

// Detect if running as PWA
if (isStandalone) {
  console.log("📱 Running as installed PWA");
}

const el = (id) => document.getElementById(id);

// persistent clientId
let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "c-" + Math.random().toString(36).slice(2, 12);
  localStorage.setItem("clientId", clientId);
}

// device name
let myName = localStorage.getItem("myDeviceName") || "";

// state
let deviceListReady = false;
let latestDevices = [];

// File size limit: 10GB in bytes
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

/* -------------------- POPUP -------------------- */
function showPopup(msg, success = true) {
  const box = el("popup");
  box.textContent = msg;
  box.style.background = success ? "#4caf50" : "#e53935";
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 1800);
}

/* -------------------- INIT NAME & REGISER -------------------- */
function initializeName() {
  if (!myName) {
    myName = prompt("Enter your device name:");
    if (!myName) myName = "Unknown Device";
    localStorage.setItem("myDeviceName", myName);
    showPopup("Device name saved");
  }
  el("myDeviceName").textContent = myName;
  socket.emit("register", { name: myName, clientId });
}
initializeName();

el("editNameBtn").onclick = () => {
  const newName = prompt("Enter new device name:", myName);
  if (newName && newName.trim() !== "") {
    myName = newName.trim();
    localStorage.setItem("myDeviceName", myName);
    el("myDeviceName").textContent = myName;
    socket.emit("register", { name: myName, clientId });
    showPopup("Device name updated");
  }
};

/* -------------------- THEME -------------------- */
const themeBtn = el("themeToggle");
const sunIcon = themeBtn.querySelector('.sun-icon');
const moonIcon = themeBtn.querySelector('.moon-icon');

if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark");
  if (sunIcon) sunIcon.style.display = "block";
  if (moonIcon) moonIcon.style.display = "none";
} else {
  if (sunIcon) sunIcon.style.display = "none";
  if (moonIcon) moonIcon.style.display = "block";
}

themeBtn.onclick = () => {
  document.body.classList.toggle("dark");
  const dark = document.body.classList.contains("dark");

  if (dark) {
    if (sunIcon) sunIcon.style.display = "block";
    if (moonIcon) moonIcon.style.display = "none";
  } else {
    if (sunIcon) sunIcon.style.display = "none";
    if (moonIcon) moonIcon.style.display = "block";
  }
  
  localStorage.setItem("theme", dark ? "dark" : "light");
};

/* -------------------- SAVE / LOAD SELECTED -------------------- */
function saveSelectedDevices() {
  const selected = [...document.querySelectorAll(".device-check")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  localStorage.setItem("selectedDevices", JSON.stringify(selected));
}
function loadSelectedDevices() {
  try {
    return JSON.parse(localStorage.getItem("selectedDevices")) || [];
  } catch {
    return [];
  }
}

/* -------------------- RENDER DEVICES -------------------- */
socket.on("devices", (list) => {
  latestDevices = list;
  const container = el("devices");
  const checkboxContainer = el("deviceCheckboxList");
  container.innerHTML = "";
  checkboxContainer.innerHTML = "";

  list.forEach((d) => {
    if (d.clientId === clientId) return;

    const card = document.createElement("div");
    card.className = "device-card";
    card.innerHTML = `<span>${d.name}</span><span style="color:green;font-size:12px">● online</span>`;
    container.appendChild(card);

    const row = document.createElement("div");
    row.className = "device-row";
    row.innerHTML = `<input type="checkbox" class="device-check" value="${d.clientId}"><label>${d.name}</label>`;
    checkboxContainer.appendChild(row);
  });

  deviceListReady = true;
  restoreSavedSelections();
});

/* -------------------- FILE INPUT & DROP -------------------- */
const dropZone = el("dropZone");
const fileInputFiles = el("fileInputFiles");
const fileInputFolders = el("fileInputFolders");

let currentFiles = [];

dropZone.onclick = () => {
  fileInputFiles.click();
};

dropZone.ondragover = (e) => {
  e.preventDefault();
  dropZone.style.borderColor = "#4caf50";
};

dropZone.ondragleave = () => {
  dropZone.style.borderColor = "var(--border)";
};

// 🚀 OPTIMIZED: Faster file handling
async function handleFileSelection(input) {
  const files = [...input.files];
  if (files.length === 0) return;

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_FILE_SIZE) {
    showPopup(
      `Total size exceeds 10GB limit (${(totalSize / 1024 ** 3).toFixed(2)}GB)`,
      false
    );
    return;
  }

  const hasRelPaths = files.some(
    (f) => f.webkitRelativePath && f.webkitRelativePath !== ""
  );

  if (!hasRelPaths) {
    currentFiles = files;
    showFilePreview(files);
    return;
  }

  // Folder upload - zip with better compression
  showPopup("Zipping folder...");
  const zip = new JSZip();

  // 🚀 OPTIMIZED: Batch file addition
  const addPromises = files.map((file) =>
    zip.file(file.webkitRelativePath, file)
  );
  await Promise.all(addPromises);

  const firstPath = files[0].webkitRelativePath;
  let root = firstPath.split("/")[0] || "folder";

  const roots = new Set(
    files.map((f) => (f.webkitRelativePath || "").split("/")[0])
  );
  if (roots.size > 1) root = "archive";

  // 🚀 OPTIMIZED: Better compression settings
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }, // Balance speed vs size
  });

  const zipFile = new File([zipBlob], `${root}.zip`, {
    type: "application/zip",
  });

  if (zipFile.size > MAX_FILE_SIZE) {
    showPopup(
      `Zip exceeds 10GB limit (${(zipFile.size / 1024 ** 3).toFixed(2)}GB)`,
      false
    );
    return;
  }

  currentFiles = [zipFile];
  showFilePreview([zipFile]);
  showPopup("Folder ready to send");
}

fileInputFiles.onchange = () => handleFileSelection(fileInputFiles);
fileInputFolders.onchange = () => handleFileSelection(fileInputFolders);

// 🚀 OPTIMIZED: Faster drop handling
dropZone.ondrop = async (e) => {
  e.preventDefault();
  dropZone.style.borderColor = "var(--border)";

  const items = e.dataTransfer.items;
  if (!items) {
    const files = [...e.dataTransfer.files];
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_FILE_SIZE) {
      showPopup(
        `Total size exceeds 10GB (${(totalSize / 1024 ** 3).toFixed(2)}GB)`,
        false
      );
      return;
    }
    currentFiles = files;
    showFilePreview(files);
    return;
  }

  let hasDirectory = false;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry && entry.isDirectory) {
      hasDirectory = true;
      break;
    }
  }

  if (!hasDirectory) {
    const files = [...e.dataTransfer.files];
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_FILE_SIZE) {
      showPopup(`Total size exceeds 10GB`, false);
      return;
    }
    currentFiles = files;
    showFilePreview(files);
    return;
  }

  showPopup("Zipping folder(s)...");
  const zip = new JSZip();

  async function readEntryDir(entry, path) {
    const reader = entry.createReader();
    const entries = await new Promise((resolve) => reader.readEntries(resolve));
    for (const ent of entries) {
      if (ent.isFile) {
        await new Promise((resolve) => {
          ent.file((file) => {
            const fullPath = path ? `${path}/${file.name}` : file.name;
            zip.file(fullPath, file);
            resolve();
          });
        });
      } else if (ent.isDirectory) {
        await readEntryDir(ent, path ? `${path}/${ent.name}` : ent.name);
      }
    }
  }

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (!entry) continue;
    if (entry.isFile) {
      await new Promise((resolve) => {
        entry.file((f) => {
          zip.file(f.name, f);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      await readEntryDir(entry, entry.name);
    }
  }

  const topRoots = new Set();
  Object.keys(zip.files).forEach((p) => {
    const seg = p.split("/")[0];
    if (seg) topRoots.add(seg);
  });
  const zipName =
    topRoots.size === 1 ? `${[...topRoots][0]}.zip` : "archive.zip";

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const zipFile = new File([zipBlob], zipName, { type: "application/zip" });

  if (zipFile.size > MAX_FILE_SIZE) {
    showPopup(`Zip exceeds 10GB`, false);
    return;
  }

  currentFiles = [zipFile];
  showFilePreview([zipFile]);
  showPopup("Folder ready to send");
};

function showFilePreview(files) {
  if (files.length > 0) {
    el("filePreview").classList.remove("hidden");
    el("filePreview").innerHTML = files
      .map((f) => {
        const sizeMB = (f.size / (1024 * 1024)).toFixed(2);
        const sizeGB = (f.size / (1024 * 1024 * 1024)).toFixed(2);
        const sizeStr =
          f.size > 1024 * 1024 * 1024 ? `${sizeGB} GB` : `${sizeMB} MB`;
        return `<div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; margin-right:6px;">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
          </svg>
          ${f.name} (${sizeStr})
        </div>`;
      })
      .join("");
  } else {
    el("filePreview").classList.add("hidden");
  }
  validateSendButton();
}

function validateSendButton() {
  const hasFile = currentFiles.length > 0;
  const hasDevice =
    [...document.querySelectorAll(".device-check")].filter((cb) => cb.checked)
      .length > 0;
  el("sendBtn").disabled = !(hasFile && hasDevice);
}

function restoreSavedSelections() {
  if (!deviceListReady) return;
  const saved = new Set(loadSelectedDevices());
  const checkboxes = document.querySelectorAll(".device-check");
  checkboxes.forEach((cb) => {
    if (saved.has(cb.value)) cb.checked = true;
    cb.onchange = () => {
      validateSendButton();
      saveSelectedDevices();
    };
  });
  validateSendButton();
}

/* -------------------- 🚀 OPTIMIZED SEND with XHR -------------------- */

// NEW: Track pending approvals
const pendingApprovals = new Map();

el("sendBtn").onclick = async () => {
  const files = currentFiles;
  const targets = [...document.querySelectorAll(".device-check")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);

  if (files.length === 0) return showPopup("Select a file or folder", false);
  if (targets.length === 0)
    return showPopup("Select at least one device", false);

  el("sendMsg").innerHTML = "";
  const statusArea = document.createElement("div");

  targets.forEach((cid) => {
    const name = latestDevices.find((d) => d.clientId === cid)?.name || cid;
    const row = document.createElement("div");
    row.id = `status-${cid}`;
    row.innerHTML = `<div><b>${name}:</b> <span class="status-text">requesting approval...</span></div>
      <div class="progress"><div id="upload-bar-${cid}" class="progress-bar"></div></div>
      <div style="font-size:12px;margin-top:4px;color:#666" id="speed-${cid}"></div>`;
    statusArea.appendChild(row);
  });
  el("sendMsg").appendChild(statusArea);

  // NEW: Request approval for each target
  for (const toClientId of targets) {
    const requestId = `req-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Store files for later sending
    pendingApprovals.set(requestId, { files, toClientId });

    // Send approval request
    const fileInfo = files.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    socket.emit("request-file-approval", {
      requestId,
      fromName: myName,
      fromClientId: clientId,
      toClientId,
      files: fileInfo,
      totalSize,
    });

    const statusTextEl = document.querySelector(
      `#status-${toClientId} .status-text`
    );
    if (statusTextEl) statusTextEl.textContent = "waiting for approval...";
  }
};

// NEW: Handle approval response
socket.on("file-approved", async (data) => {
  const { requestId, approved, toClientId } = data;
  const pending = pendingApprovals.get(requestId);

  if (!pending) return;

  const statusTextEl = document.querySelector(
    `#status-${toClientId} .status-text`
  );

  if (!approved) {
    if (statusTextEl) statusTextEl.textContent = "rejected ";
    showPopup("File transfer rejected", false);
    pendingApprovals.delete(requestId);
    return;
  }

  // Approved - send files
  if (statusTextEl) statusTextEl.textContent = "approved! uploading...";

  try {
    const form = new FormData();
    for (const f of pending.files) form.append("file", f);
    form.append("toClientId", toClientId);
    form.append("fromName", myName);
    form.append("approved", "true"); // NEW: Mark as approved

    await uploadWithProgress(form, toClientId);
    pendingApprovals.delete(requestId);
  } catch (err) {
    if (statusTextEl) statusTextEl.textContent = "error ";
    showPopup("Upload failed", false);
    console.error(err);
  }
});
// el("sendBtn").onclick = async () => {
//   const files = currentFiles;
//   const targets = [...document.querySelectorAll(".device-check")]
//     .filter((cb) => cb.checked)
//     .map((cb) => cb.value);

//   if (files.length === 0) return showPopup("Select a file or folder", false);
//   if (targets.length === 0) return showPopup("Select at least one device", false);

//   el("sendMsg").innerHTML = "";
//   const statusArea = document.createElement("div");
//   targets.forEach((cid) => {
//     const name = latestDevices.find((d) => d.clientId === cid)?.name || cid;
//     const row = document.createElement("div");
//     row.id = `status-${cid}`;
//     row.innerHTML = `<div><b>${name}:</b> <span class="status-text">uploading...</span></div>
//       <div class="progress"><div id="upload-bar-${cid}" class="progress-bar"></div></div>
//       <div style="font-size:12px;margin-top:4px;color:#666" id="speed-${cid}"></div>`;
//     statusArea.appendChild(row);
//   });
//   el("sendMsg").appendChild(statusArea);

//   try {
//     for (const toClientId of targets) {
//       const form = new FormData();
//       for (const f of files) form.append("file", f);
//       form.append("toClientId", toClientId);
//       form.append("fromName", myName);

//       await uploadWithProgress(form, toClientId);
//     }
//     showPopup("Send finished ✓");
//   } catch (err) {
//     showPopup("Network error", false);
//     console.error(err);
//   }
// };

// 🚀 OPTIMIZED: Speed calculation and better progress
function uploadWithProgress(formData, toClientId) {
  return new Promise((resolve, reject) => {
    formData.append("senderSocketId", socket.id);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload");
    const bar = document.getElementById(`upload-bar-${toClientId}`);
    const statusTextEl = document.querySelector(
      `#status-${toClientId} .status-text`
    );
    const speedEl = document.getElementById(`speed-${toClientId}`);

    let startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;

    xhr.upload.onprogress = (e) => {
      if (!bar) return;
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + "%";

        // 🚀 Calculate speed
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000; // seconds
        const bytesDiff = e.loaded - lastLoaded;

        if (timeDiff > 0.5) {
          // Update every 500ms
          const speedMBps = bytesDiff / timeDiff / (1024 * 1024);
          const remainingBytes = e.total - e.loaded;
          const etaSeconds = remainingBytes / (bytesDiff / timeDiff);

          if (speedEl) {
            speedEl.textContent = `${speedMBps.toFixed(
              2
            )} MB/s • ${pct}% • ETA: ${formatTime(etaSeconds)}`;
          }

          lastLoaded = e.loaded;
          lastTime = now;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (statusTextEl) statusTextEl.textContent = "sent ✓";
        if (speedEl) speedEl.textContent = "Complete!";
        resolve(JSON.parse(xhr.responseText));
      } else {
        if (statusTextEl) statusTextEl.textContent = "failed ✗";
        reject(new Error("Upload failed: " + xhr.status));
      }
    };

    xhr.onerror = () => {
      if (statusTextEl) statusTextEl.textContent = "error ✗";
      reject(new Error("Network error"));
    };

    xhr.send(formData);
  });
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600)
    return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

/* -------------------- 🚀 OPTIMIZED RECEIVE (faster chunk processing) -------------------- */
const fileBuffers = {};

function updateProgressUIReceive(fileName, bytes, total) {
  let card = document.getElementById("card-" + fileName);
  if (!card) {
    const box = el("receiveBox");
    const div = document.createElement("div");
    div.id = "card-" + fileName;
    div.className = "receive-card";
    div.innerHTML = `
      <div><b>${fileName}</b></div>
      <div class="progress"><div class="progress-bar" id="bar-${fileName}"></div></div>
      <div style="font-size:12px;margin-top:4px;color:#666" id="recv-info-${fileName}"></div>
    `;
    box.prepend(div);
  }

  const bar = document.getElementById("bar-" + fileName);
  const info = document.getElementById("recv-info-" + fileName);

  if (total && total > 0) {
    const pct = Math.round((bytes / total) * 100);
    if (bar) bar.style.width = pct + "%";
    if (info) {
      const receivedMB = (bytes / (1024 * 1024)).toFixed(2);
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      info.textContent = `${receivedMB} MB / ${totalMB} MB (${pct}%)`;
    }
  } else {
    const pct = Math.min(100, Math.round((bytes / (100 * 1024 * 1024)) * 100));
    if (bar) bar.style.width = pct + "%";
    if (info) {
      const receivedMB = (bytes / (1024 * 1024)).toFixed(2);
      info.textContent = `${receivedMB} MB received`;
    }
  }
}

socket.on("file-start", (data) => {
  fileBuffers[data.name] = {
    chunks: [],
    receivedBytes: 0,
    totalSize: data.totalSize || 0,
    from: data.from,
  };
  updateProgressUIReceive(data.name, 0, data.totalSize);
});

socket.on("file-chunk", (data) => {
  let chunk = data.chunk;

  // Normalize chunk data
  if (Array.isArray(chunk)) {
    chunk = new Uint8Array(chunk);
  } else if (chunk?.data) {
    chunk = new Uint8Array(chunk.data);
  } else if (!(chunk instanceof Uint8Array)) {
    chunk = new Uint8Array(chunk);
  }

  if (!fileBuffers[data.name]) {
    fileBuffers[data.name] = {
      chunks: [],
      receivedBytes: 0,
      totalSize: data.totalSize || 0,
      from: data.from,
    };
  }

  fileBuffers[data.name].chunks.push(chunk);
  fileBuffers[data.name].receivedBytes = data.receivedBytes;

  updateProgressUIReceive(data.name, data.receivedBytes, data.totalSize);
});

// ✅ NEW: Listen for transfer updates from server (for SENDER)
socket.on("transfer-started", (data) => {
  const statusTextEl = document.querySelector(
    `#status-${data.toSocketId} .status-text`
  );
  if (statusTextEl) statusTextEl.textContent = "transferring...";
});

socket.on("transfer-progress", (data) => {
  // Update sender's progress bar based on receiver's progress
  const deviceId = latestDevices.find(
    (d) => d.socketId === data.toSocketId
  )?.clientId;
  if (deviceId) {
    const bar = document.getElementById(`upload-bar-${deviceId}`);
    const speedEl = document.getElementById(`speed-${deviceId}`);

    if (bar) {
      bar.style.width = data.progress + "%";
    }

    if (speedEl) {
      const sentMB = (data.sentBytes / (1024 * 1024)).toFixed(2);
      const totalMB = (data.totalSize / (1024 * 1024)).toFixed(2);
      speedEl.textContent = `${data.progress}% • ${sentMB}/${totalMB} MB`;
    }
  }
});

socket.on("transfer-complete", (data) => {
  const deviceId = latestDevices.find(
    (d) => d.socketId === data.toSocketId
  )?.clientId;
  if (deviceId) {
    const statusTextEl = document.querySelector(
      `#status-${deviceId} .status-text`
    );
    if (statusTextEl) statusTextEl.textContent = "sent ✓";
  }
});

socket.on("file-complete", (data) => {
  const entry = fileBuffers[data.name];
  if (!entry) {
    showPopup(`Finished receiving ${data.name}`, true);
    return;
  }

  const blob = new Blob(entry.chunks, { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = data.name;
  a.click();

  delete fileBuffers[data.name];
  showPopup(`Downloaded ${data.name} ✓`);

  // Clean up UI
  const card = document.getElementById("card-" + data.name);
  if (card) {
    setTimeout(() => card.remove(), 3000);
  }
});

// NEW: Handle incoming approval requests
socket.on("file-approval-request", (data) => {
  const modal = el("approvalModal");
  const sender = el("approvalSender");
  const fileList = el("approvalFileList");
  const totalSize = el("approvalTotalSize");

  sender.textContent = `From: ${data.fromName}`;

  fileList.innerHTML = data.files
    .map((f) => {
      const sizeMB = (f.size / (1024 * 1024)).toFixed(2);
      const sizeGB = (f.size / (1024 * 1024 * 1024)).toFixed(2);
      const sizeStr =
        f.size > 1024 * 1024 * 1024 ? `${sizeGB} GB` : `${sizeMB} MB`;
      return `<div class="approval-file-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; margin-right:6px;">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
          <polyline points="13 2 13 9 20 9"></polyline>
        </svg>
        ${f.name} (${sizeStr})
      </div>`;
    })
    .join(""); 

  const totalMB = (data.totalSize / (1024 * 1024)).toFixed(2);
  const totalGB = (data.totalSize / (1024 * 1024 * 1024)).toFixed(2);
  const totalStr =
    data.totalSize > 1024 * 1024 * 1024 ? `${totalGB} GB` : `${totalMB} MB`;
  totalSize.textContent = `Total size: ${totalStr}`;

  modal.classList.remove("hidden");

  // Handle accept
  el("approvalAccept").onclick = () => {
    socket.emit("file-approval-response", {
      requestId: data.requestId,
      approved: true,
      fromClientId: data.fromClientId,
      toClientId: clientId,
    });
    modal.classList.add("hidden");
    showPopup("File transfer accepted ");
  };

  // Handle reject
  el("approvalReject").onclick = () => {
    socket.emit("file-approval-response", {
      requestId: data.requestId,
      approved: false,
      fromClientId: data.fromClientId,
      toClientId: clientId,
    });
    modal.classList.add("hidden");
    showPopup("File transfer rejected ", false);
  };
});
/* ========================================
   EPHEMERAL CHAT SYSTEM (3-HOUR AUTO-DELETE)
   ======================================== */

// Chat state (all in RAM, no persistence)
let currentChatPartner = null;
let chatMessages = []; // {id, from, to, text, timestamp, expiresAt}
let chatRoomId = null;

// Get chat elements
const chatUserSelect = el("chatUserSelect");
const chatMessages_el = el("chatMessages");
const chatInput = el("chatInput");
const chatSendBtn = el("chatSendBtn");
const burnChatBtn = el("burnChatBtn");
const leaveChatBtn = el("leaveChatBtn");
const onlineUsersList = el("onlineUsersList");
const chatStatus = el("chatStatus");

// Constants
const CHAT_EXPIRY_MS = 3 * 60 * 60 * 1000; // 3 hours
const CLEANUP_INTERVAL = 60 * 1000; // Check every minute

/* -------------------- UPDATE ONLINE USERS -------------------- */
function updateChatOnlineUsers(devices) {
  // Update dropdown
  chatUserSelect.innerHTML = '<option value="">Select a user...</option>';

  // Update badges
  onlineUsersList.innerHTML = "";

  devices.forEach((d) => {
    if (d.clientId === clientId) return; // Skip self

    // Add to dropdown
    const option = document.createElement("option");
    option.value = d.clientId;
    option.textContent = d.name;
    chatUserSelect.appendChild(option);

    // Add badge
    const badge = document.createElement("div");
    badge.className = "online-user-badge";
    badge.innerHTML = `<span class="online-dot"></span>${d.name}`;
    onlineUsersList.appendChild(badge);
  });

  // If current partner is offline, notify
  if (currentChatPartner) {
    const partnerOnline = devices.find(
      (d) => d.clientId === currentChatPartner
    );
    if (!partnerOnline) {
      addSystemMessage(
        "User went offline. Chat room still active for 3 hours."
      );
    }
  }
}

// Listen to device updates for chat
socket.on("devices", (list) => {
  // ... existing code stays ...
  latestDevices = list;
  // ... rest of existing device code ...

  // NEW: Update chat users
  updateChatOnlineUsers(list);
});

/* -------------------- CHAT ROOM MANAGEMENT -------------------- */
chatUserSelect.onchange = () => {
  const selectedUserId = chatUserSelect.value;
  if (!selectedUserId) return;

  const selectedUser = latestDevices.find((d) => d.clientId === selectedUserId);
  if (!selectedUser) return;

  // Generate deterministic room ID (alphabetically sorted to match both users)
  const users = [clientId, selectedUserId].sort();
  chatRoomId = `room_${users[0]}_${users[1]}`;
  currentChatPartner = selectedUserId;

  // Enable chat
  chatInput.disabled = false;
  chatSendBtn.disabled = false;

  // Join room
  socket.emit("join-chat-room", { roomId: chatRoomId, userName: myName });

  // Enable chat
  chatInput.disabled = false;
  chatSendBtn.disabled = false;

  // Join room
  socket.emit("join-chat-room", { roomId: chatRoomId, userName: myName });

  // ✅ NEW: Try to load from localStorage first
  const loadedFromStorage = loadChatFromStorage();

  if (loadedFromStorage) {
    renderChatMessages();
    addSystemMessage(`📜 Restored previous chat with ${selectedUser.name}`);
  } else {
    // Clear and show welcome
    chatMessages = [];
    renderChatMessages();
    addSystemMessage(
      `🔒 Secure chat with ${selectedUser.name}. Messages expire in 3 hours.`
    );
  }

  showPopup(`Chat started with ${selectedUser.name}`);
};

/* -------------------- SEND MESSAGE -------------------- */
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentChatPartner || !chatRoomId) return;

  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    from: clientId,
    fromName: myName,
    to: currentChatPartner,
    text: text,
    timestamp: Date.now(),
    expiresAt: Date.now() + CHAT_EXPIRY_MS,
    roomId: chatRoomId,
  };

  // Send to server
  socket.emit("chat-message", message);

  // Add to local messages
  chatMessages.push(message);
  renderChatMessages();

  // Clear input
  chatInput.value = "";
  chatInput.focus();
}

chatSendBtn.onclick = sendChatMessage;
chatInput.onkeypress = (e) => {
  if (e.key === "Enter") sendChatMessage();
};

/* -------------------- RECEIVE CHAT HISTORY (when joining) -------------------- */
socket.on("chat-history", (data) => {
  if (data.roomId === chatRoomId) {
    // Load all previous messages
    chatMessages = data.messages;
    renderChatMessages();
    addSystemMessage(`📜 Loaded ${data.messages.length} previous message(s)`);
  }
});

/* -------------------- RECEIVE MESSAGE -------------------- */
socket.on("chat-message", (message) => {
  // Only accept messages for current room
  if (message.roomId === chatRoomId) {
    chatMessages.push(message);
    renderChatMessages();
    saveChatToStorage();

    // Play notification sound (optional)
    if (message.from !== clientId) {
      playNotificationSound();
    }
  }
});

// ✅ NEW: Save messages to localStorage
function saveChatToStorage() {
  if (chatRoomId && chatMessages.length > 0) {
    const chatData = {
      roomId: chatRoomId,
      partnerId: currentChatPartner,
      messages: chatMessages,
      savedAt: Date.now(),
    };
    localStorage.setItem(`chat_${chatRoomId}`, JSON.stringify(chatData));
  }
}

// ✅ NEW: Load messages from localStorage
function loadChatFromStorage() {
  if (!chatRoomId) return false;

  try {
    const stored = localStorage.getItem(`chat_${chatRoomId}`);
    if (stored) {
      const chatData = JSON.parse(stored);

      // Only load if less than 3 hours old
      const age = Date.now() - chatData.savedAt;
      if (age < CHAT_EXPIRY_MS) {
        chatMessages = chatData.messages;
        return true;
      } else {
        // Clear expired
        localStorage.removeItem(`chat_${chatRoomId}`);
      }
    }
  } catch (e) {
    console.error("Failed to load chat:", e);
  }
  return false;
}

/* -------------------- RENDER MESSAGES -------------------- */
function renderChatMessages() {
  if (chatMessages.length === 0) {
    chatMessages_el.innerHTML = `
      <div class="chat-empty-state">
        <div class="icon">💬</div>
        <p><strong>Start chatting!</strong></p>
        <p style="font-size: 13px; margin-top: 8px;">
          Messages will auto-delete in 3 hours
        </p>
      </div>
    `;
    return;
  }

  chatMessages_el.innerHTML = "";

  chatMessages.forEach((msg) => {
    const isOwn = msg.from === clientId;
    const timeLeft = msg.expiresAt - Date.now();
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    const messageEl = document.createElement("div");
    messageEl.className = `chat-message ${isOwn ? "own" : "other"}`;

    messageEl.innerHTML = `
      ${!isOwn ? `<div class="message-sender">${msg.fromName}</div>` : ""}
      <div class="message-bubble">
        ${escapeHtml(msg.text)}
        <div class="message-time">${formatTimestamp(msg.timestamp)}</div>
        <div class="message-destructs-in"> ${hoursLeft}h ${minutesLeft}m left</div>
      </div>
    `;

    chatMessages_el.appendChild(messageEl);
  });

  // Auto-scroll to bottom
  chatMessages_el.scrollTop = chatMessages_el.scrollHeight;
}

/* -------------------- SYSTEM MESSAGES -------------------- */
function addSystemMessage(text) {
  const systemMsg = document.createElement("div");
  systemMsg.className = "system-message";
  systemMsg.textContent = text;
  chatMessages_el.appendChild(systemMsg);
  chatMessages_el.scrollTop = chatMessages_el.scrollHeight;
}

/* -------------------- BURN MODE (DELETE ALL) -------------------- */
burnChatBtn.onclick = () => {
  if (!chatRoomId) {
    showPopup("No active chat to burn", false);
    return;
  }

  if (confirm(" BURN ALL MESSAGES? This cannot be undone!")) {
    // Emit burn event to all room members
    socket.emit("burn-chat", { roomId: chatRoomId });

    // Clear locally
    chatMessages = [];
    renderChatMessages();
    if (chatRoomId) localStorage.removeItem(`chat_${chatRoomId}`);
    addSystemMessage(" All messages burned!");

    showPopup("Chat burned! ");
  }
};

// Receive burn event
socket.on("chat-burned", (data) => {
  if (data.roomId === chatRoomId) {
    chatMessages = [];
    renderChatMessages();
    addSystemMessage(" Chat was burned by another user!");
    showPopup("Chat burned!", false);
  }
});

/* -------------------- LEAVE CHAT -------------------- */
leaveChatBtn.onclick = () => {
  if (!chatRoomId) {
    showPopup("No active chat", false);
    return;
  }

  // Notify room
  socket.emit("leave-chat-room", { roomId: chatRoomId, userName: myName });

  // Reset state
  currentChatPartner = null;
  const oldRoomId = chatRoomId; // ✅ FIX: Save roomId before clearing
  chatRoomId = null;
  chatMessages = [];
  if (oldRoomId) localStorage.removeItem(`chat_${oldRoomId}`); // ✅ FIX: Now oldRoomId is defined
  chatUserSelect.value = "";
  chatInput.disabled = true;
  chatSendBtn.disabled = true;

  renderChatMessages();
  showPopup("Left chat room");
};

// Receive leave notification
socket.on("user-left-chat", (data) => {
  if (data.roomId === chatRoomId) {
    addSystemMessage(
      `${data.userName} left the chat. Room stays active for 3 hours.`
    );
  }
});

// Receive join notification
socket.on("user-joined-chat", (data) => {
  if (data.roomId === chatRoomId && data.userName !== myName) {
    addSystemMessage(`${data.userName} joined the chat`);
  }
});

/* -------------------- AUTO-CLEANUP (3 HOURS) -------------------- */
setInterval(() => {
  const now = Date.now();
  const before = chatMessages.length;

  // Remove expired messages
  chatMessages = chatMessages.filter((msg) => msg.expiresAt > now);

  if (chatMessages.length < before) {
    renderChatMessages();
    if (chatMessages.length === 0 && currentChatPartner) {
      addSystemMessage("🕒 All messages expired (3 hours passed)");
    }
  }

  // Update destructs-in timers
  if (chatMessages.length > 0) {
    renderChatMessages();
  }
}, CLEANUP_INTERVAL);

/* -------------------- HELPER FUNCTIONS -------------------- */
function formatTimestamp(ts) {
  const date = new Date(ts);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function playNotificationSound() {
  // Optional: play a subtle notification sound
  const audio = new Audio(
    "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZizMIGGW56+qeSwkOVKzn7aRVFQxNqOTxtWomBS51xvDdkT4KFlm05OunTQ8QSKPp7bhiHwc3jsLx1YIyCAhjuOrrrlQMEmqy6OqiSQ0HGmW5/O+iTgoUW7Xk66RVFQxOnebxt2snBTBxxfHdkT4IFVi05uunTQ8QSKPp7bhiHwc3jsLx1YIyCAhjuOrrrlQMEmqy6OqiSQ0HGmW5/O+iTgoUW7Xk66RVFQxOnebxt2snBTBxxfHdkT4KE2S56u2bUQwQTarh8K1hGAQ3jcXy1YEyBwdkuevqnlENDlyy5eykTxILXb3k66lSEg5apd7xtmciBS52xPLdkDwIFl205uyoTg8PVKzn7aFVFApGn+DyvmwhBSuBzvLZizMIGGW56+qeSQsOW7Tl7aRXEwxPo+furWEbBC53xfHdkj4KFVu05O2nTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4KFVm04OqnTg0QVKvn7KRVFQxNqOLxt2wmBCx3xfHekj4K"
  );
  audio.volume = 0.3;
  audio.play().catch(() => {}); // Silent fail if blocked
}

/* -------------------- INITIAL STATE -------------------- */
chatInput.disabled = true;
chatSendBtn.disabled = true;
