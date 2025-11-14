// =======================================
//  OyeSwap - FINAL script.js (folder root preservation)
// =======================================

const socket = io();
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

/* -------------------- SAVE / LOAD SELECTED (by clientId) -------------------- */
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

/* -------------------- RESTORE CHECKBOXES -------------------- */
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

/* -------------------- FILE INPUT & DROP (PRESERVE ROOT) -------------------- */
const dropZone = el("dropZone");
const fileInput = el("fileInput");

// click to open file picker (HTML must include webkitdirectory attribute to allow folder)
dropZone.onclick = () => fileInput.click();

// When user selects via file dialog (may be files or folder with webkitRelativePath)
fileInput.onchange = async () => {
  const files = [...fileInput.files];
  if (files.length === 0) return;

  // check webkitRelativePath presence
  const hasRelPaths = files.some((f) => f.webkitRelativePath && f.webkitRelativePath !== "");

  if (!hasRelPaths) {
    // normal files selected
    showFilePreview();
    return;
  }

  // If there are relative paths, keep them as-is so zip preserves top-level folder(s)
  showPopup("Zipping folder...");
  const zip = new JSZip();

  files.forEach((file) => {
    // use the full webkitRelativePath inside zip (preserves top-level folder)
    zip.file(file.webkitRelativePath, file);
  });

  // name the zip using the first top-level folder(s)
  const firstPath = files[0].webkitRelativePath;
  let root = firstPath.split("/")[0] || "folder";
  // If multiple distinct roots, use generic "archive"
  const roots = new Set(files.map((f) => (f.webkitRelativePath || "").split("/")[0]));
  if (roots.size > 1) root = "archive";

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([zipBlob], `${root}.zip`, { type: "application/zip" });

  const dt = new DataTransfer();
  dt.items.add(zipFile);
  fileInput.files = dt.files;

  showFilePreview();
  showPopup("Folder ready to send");
};

// Drag handlers
dropZone.ondragover = (e) => {
  e.preventDefault();
  dropZone.style.borderColor = "#4caf50";
};
dropZone.ondragleave = () => {
  dropZone.style.borderColor = "var(--border)";
};

dropZone.ondrop = async (e) => {
  e.preventDefault();
  dropZone.style.borderColor = "var(--border)";

  const items = e.dataTransfer.items;
  if (!items) {
    // fallback
    fileInput.files = e.dataTransfer.files;
    showFilePreview();
    return;
  }

  // Detect if there is any directory entry
  let hasDirectory = false;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry && entry.isDirectory) {
      hasDirectory = true;
      break;
    }
  }

  if (!hasDirectory) {
    // simple file drop
    fileInput.files = e.dataTransfer.files;
    showFilePreview();
    return;
  }

  // Directory(s) dropped -> traverse and preserve full paths
  showPopup("Zipping folder(s)...");
  const zip = new JSZip();

  async function readEntryDir(entry, path) {
    const reader = entry.createReader();
    const entries = await new Promise((resolve) => reader.readEntries(resolve));
    for (const ent of entries) {
      if (ent.isFile) {
        await new Promise((resolve) => {
          ent.file((file) => {
            // path includes parent folder names already
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

  // Process top-level items, include each top-level folder name in paths
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (!entry) continue;
    if (entry.isFile) {
      // file dropped at top level
      await new Promise((resolve) => {
        entry.file((f) => {
          zip.file(f.name, f);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      // include directory name as root in path
      await readEntryDir(entry, entry.name);
    }
  }

  // determine zip root name: if single top-level folder, use that, else "archive"
  const topRoots = new Set();
  // collect top-level folder names from zip files by inspecting first segment of file paths
  Object.keys(zip.files).forEach((p) => {
    const seg = p.split("/")[0];
    if (seg) topRoots.add(seg);
  });
  const zipName = topRoots.size === 1 ? `${[...topRoots][0]}.zip` : "archive.zip";

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([zipBlob], zipName, { type: "application/zip" });

  const dt = new DataTransfer();
  dt.items.add(zipFile);
  fileInput.files = dt.files;

  showFilePreview();
  showPopup("Folder ready to send");
};

/* -------------------- SHOW PREVIEW -------------------- */
function showFilePreview() {
  const files = [...fileInput.files];
  if (files.length > 0) {
    el("filePreview").classList.remove("hidden");
    el("filePreview").innerHTML = files.map((f) => `<div>${f.name}</div>`).join("");
  } else {
    el("filePreview").classList.add("hidden");
  }
  validateSendButton();
}

/* -------------------- VALIDATE SEND -------------------- */
function validateSendButton() {
  const hasFile = fileInput.files.length > 0;
  const hasDevice = [...document.querySelectorAll(".device-check")].filter((cb) => cb.checked).length > 0;
  el("sendBtn").disabled = !(hasFile && hasDevice);
}

/* -------------------- SEND FILE(s) -------------------- */
el("sendBtn").onclick = async () => {
  const files = [...fileInput.files];
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
    row.textContent = `${name}: sending...`;
    statusArea.appendChild(row);
  });
  el("sendMsg").appendChild(statusArea);

  try {
    for (const toClientId of targets) {
      const form = new FormData();
      files.forEach((f) => form.append("file", f));
      form.append("toClientId", toClientId);
      form.append("fromName", myName);

      const res = await fetch("/upload", { method: "POST", body: form });
      const json = await res.json();
      const statusLine = el(`status-${toClientId}`);
      if (!res.ok) {
        statusLine.textContent = `${statusLine.textContent.split(":")[0]}: failed`;
        statusLine.style.color = "red";
      } else {
        const summary = json.delivered.map((f) => `${f.name} (${f.status})`).join(", ");
        statusLine.textContent = `${statusLine.textContent.split(":")[0]}: ${summary}`;
        statusLine.style.color = "green";
      }
    }
    showPopup("Send finished");
  } catch (err) {
    showPopup("Network error", false);
  }
};

/* -------------------- RECEIVE -------------------- */
socket.on("file-transfer", (data) => {
  const box = el("receiveBox");
  const card = document.createElement("div");
  card.className = "receive-card";
  card.innerHTML = `
    <strong>From:</strong> ${data.from}<br>
    <strong>File:</strong> ${data.fileName}<br><br>
    <button class="downloadBtn">Download</button>
  `;
  box.prepend(card);
  card.querySelector(".downloadBtn").onclick = () => {
    const a = document.createElement("a");
    a.href = "data:" + data.fileType + ";base64," + data.fileData;
    a.download = data.fileName;
    a.click();
  };
  showPopup(`File received: ${data.fileName}`);
  window.scrollTo(0, document.body.scrollHeight);
});
