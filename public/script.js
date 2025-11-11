const socket = io();
let myName = "";
let mySocketId = null;
let latestDevices = [];

const el = (id) => document.getElementById(id);

socket.on("connect", () => {
  mySocketId = socket.id;
});

socket.on("devices", (list) => {
  latestDevices = list;
  renderDevices(list);
  fillSelect(list);
});

socket.on("incoming-file", ({ from, fileName }) => {
  el("incomingMsg").textContent = `Incoming: "${fileName}" from ${from}`;
  // Optional: auto-refresh files
  loadFiles();
});

el("registerBtn").onclick = () => {
  myName = el("deviceName").value.trim() || "Unknown";
  socket.emit("register", { name: myName });
};

el("sendBtn").onclick = async () => {
  const file = el("fileInput").files[0];
  if (!file) return (el("sendMsg").textContent = "Choose a file first.");
  const toSocketId = el("deviceSelect").value || "";

  const form = new FormData();
  form.append("file", file);
  form.append("toSocketId", toSocketId);
  form.append("fromName", myName || "Unknown");

  el("sendMsg").textContent = "Uploading...";
  try {
    const res = await fetch("/upload", { method: "POST", body: form });
    const json = await res.json();
    if (res.ok) {
      el("sendMsg").textContent = `Uploaded as ${json.storedAs}`;
      if (toSocketId) socket.emit("send-intent", { toSocketId, fileName: json.storedAs });
      loadFiles();
    } else {
      el("sendMsg").textContent = json?.error || "Upload failed";
    }
  } catch (e) {
    el("sendMsg").textContent = "Network error";
  }
};

el("refreshBtn").onclick = loadFiles;

async function loadFiles() {
  const res = await fetch("/files");
  const files = await res.json();
  const list = el("fileList");
  list.innerHTML = "";
  files.forEach(f => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/download/${encodeURIComponent(f.name)}`;
    a.textContent = `${f.name} (${fmtBytes(f.size)})`;
    a.download = f.name;
    li.appendChild(a);
    list.appendChild(li);
  });
}

function renderDevices(devs) {
  const ul = el("devices");
  ul.innerHTML = "";
  devs.forEach(d => {
    const li = document.createElement("li");
    li.textContent = `${d.name} (${d.socketId.slice(0,6)}…)`;
    ul.appendChild(li);
  });
}

function fillSelect(devs) {
  const me = socket.id;
  const sel = el("deviceSelect");
  sel.innerHTML = "";
  const optNone = document.createElement("option");
  optNone.value = "";
  optNone.textContent = "(Just upload to server)";
  sel.appendChild(optNone);

  devs.filter(d => d.socketId !== me).forEach(d => {
    const o = document.createElement("option");
    o.value = d.socketId;
    o.textContent = d.name;
    sel.appendChild(o);
  });
}

function fmtBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024*1024) return (b/1024).toFixed(1) + " KB";
  if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + " MB";
  return (b/1024/1024/1024).toFixed(1) + " GB";
}

// initial load
loadFiles();
