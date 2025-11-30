// script.js (public)
// 🚀 OPTIMIZED for faster large file transfers
// =======================================

const socket = io({
  transports: ['websocket', 'polling'], // Prefer websocket
  upgrade: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

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

/* -------------------- INIT NAME & REGISTER -------------------- */
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
if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark");
  themeBtn.textContent = "☀️";
}
themeBtn.onclick = () => {
  document.body.classList.toggle("dark");
  const dark = document.body.classList.contains("dark");
  themeBtn.textContent = dark ? "☀️" : "🌙";
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
    showPopup(`Total size exceeds 10GB limit (${(totalSize / (1024**3)).toFixed(2)}GB)`, false);
    return;
  }

  const hasRelPaths = files.some(f => f.webkitRelativePath && f.webkitRelativePath !== "");

  if (!hasRelPaths) {
    currentFiles = files;
    showFilePreview(files);
    return;
  }

  // Folder upload - zip with better compression
  showPopup("Zipping folder...");
  const zip = new JSZip();

  // 🚀 OPTIMIZED: Batch file addition
  const addPromises = files.map(file => 
    zip.file(file.webkitRelativePath, file)
  );
  await Promise.all(addPromises);

  const firstPath = files[0].webkitRelativePath;
  let root = firstPath.split("/")[0] || "folder";

  const roots = new Set(
    files.map(f => (f.webkitRelativePath || "").split("/")[0])
  );
  if (roots.size > 1) root = "archive";

  // 🚀 OPTIMIZED: Better compression settings
  const zipBlob = await zip.generateAsync({ 
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 } // Balance speed vs size
  });
  
  const zipFile = new File([zipBlob], `${root}.zip`, { type: "application/zip" });

  if (zipFile.size > MAX_FILE_SIZE) {
    showPopup(`Zip exceeds 10GB limit (${(zipFile.size / (1024**3)).toFixed(2)}GB)`, false);
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
      showPopup(`Total size exceeds 10GB (${(totalSize / (1024**3)).toFixed(2)}GB)`, false);
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
  const zipName = topRoots.size === 1 ? `${[...topRoots][0]}.zip` : "archive.zip";

  const zipBlob = await zip.generateAsync({ 
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
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
    el("filePreview").innerHTML = files.map((f) => {
      const sizeMB = (f.size / (1024 * 1024)).toFixed(2);
      const sizeGB = (f.size / (1024 * 1024 * 1024)).toFixed(2);
      const sizeStr = f.size > 1024 * 1024 * 1024 ? `${sizeGB} GB` : `${sizeMB} MB`;
      return `<div>📦 ${f.name} (${sizeStr})</div>`;
    }).join("");
  } else {
    el("filePreview").classList.add("hidden");
  }
  validateSendButton();
}

function validateSendButton() {
  const hasFile = currentFiles.length > 0;
  const hasDevice = [...document.querySelectorAll(".device-check")].filter((cb) => cb.checked).length > 0;
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
el("sendBtn").onclick = async () => {
  const files = currentFiles;
  const targets = [...document.querySelectorAll(".device-check")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);

  if (files.length === 0) return showPopup("Select a file or folder", false);
  if (targets.length === 0) return showPopup("Select at least one device", false);

  el("sendMsg").innerHTML = "";
  const statusArea = document.createElement("div");
  targets.forEach((cid) => {
    const name = latestDevices.find((d) => d.clientId === cid)?.name || cid;
    const row = document.createElement("div");
    row.id = `status-${cid}`;
    row.innerHTML = `<div><b>${name}:</b> <span class="status-text">uploading...</span></div>
      <div class="progress"><div id="upload-bar-${cid}" class="progress-bar"></div></div>
      <div style="font-size:12px;margin-top:4px;color:#666" id="speed-${cid}"></div>`;
    statusArea.appendChild(row);
  });
  el("sendMsg").appendChild(statusArea);

  try {
    for (const toClientId of targets) {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      form.append("toClientId", toClientId);
      form.append("fromName", myName);

      await uploadWithProgress(form, toClientId);
    }
    showPopup("Send finished ✓");
  } catch (err) {
    showPopup("Network error", false);
    console.error(err);
  }
};

// 🚀 OPTIMIZED: Speed calculation and better progress
function uploadWithProgress(formData, toClientId) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload");
    const bar = document.getElementById(`upload-bar-${toClientId}`);
    const statusTextEl = document.querySelector(`#status-${toClientId} .status-text`);
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
        
        if (timeDiff > 0.5) { // Update every 500ms
          const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
          const remainingBytes = e.total - e.loaded;
          const etaSeconds = remainingBytes / (bytesDiff / timeDiff);
          
          if (speedEl) {
            speedEl.textContent = `${speedMBps.toFixed(2)} MB/s • ${pct}% • ETA: ${formatTime(etaSeconds)}`;
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
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
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
    from: data.from 
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
      from: data.from 
    };
  }

  fileBuffers[data.name].chunks.push(chunk);
  fileBuffers[data.name].receivedBytes = data.receivedBytes;

  updateProgressUIReceive(data.name, data.receivedBytes, data.totalSize);
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