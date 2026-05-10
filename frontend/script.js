// ============================================
// OyeSwap - WebRTC + AWS WebSocket
// ============================================

let ws, wsUrl = CONFIG.WS_URL;
let clientId = localStorage.getItem('oyeswap-clientid');
if (!clientId) {
  clientId = 'device-' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('oyeswap-clientid', clientId);
}

let deviceName = localStorage.getItem('oyeswap-devicename') || generateDeviceName();
function generateDeviceName() {
  const adj = ['Swift','Brave','Calm','Dark','Epic','Bold','Wise','Slick'];
  const noun = ['Tiger','Eagle','Storm','Nova','Bolt','Spark','Wave','Fox'];
  const name = adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)];
  localStorage.setItem('oyeswap-devicename', name);
  return name;
}

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  return 'desktop';
}

// ============================================
// WebSocket
// ============================================
let reconnectTimer, keepaliveTimer;
let isConnected = false;

function connectWS() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    isConnected = true;
    clearTimeout(reconnectTimer);
    updateConnectionStatus(true);
    ws.send(JSON.stringify({
      type: 'register', clientId, deviceName, deviceType: getDeviceType()
    }));
    // Keepalive every 8 min (API Gateway times out at 10 min)
    keepaliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 8 * 60 * 1000);
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    isConnected = false;
    clearInterval(keepaliveTimer);
    updateConnectionStatus(false);
    reconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();
}

function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function updateConnectionStatus(online) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot) dot.className = 'status-dot ' + (online ? 'online' : 'offline');
  if (txt) txt.textContent = online ? 'Online' : 'Reconnecting...';
}

// ============================================
// Message Handler
// ============================================
let latestDevices = [];
let peerConnections = {};
let pendingApprovals = {};

function handleMessage(msg) {
  switch(msg.type) {
    case 'devices':
      latestDevices = (msg.list || []).filter(d => d.clientId !== clientId);
      renderDevices(latestDevices);
      renderConnectedDevices(latestDevices);
      populateChatDropdown(latestDevices);
      break;
    case 'approval-request':
      showApprovalModal(msg);
      break;
    case 'approval-result':
      clearTimeout(pendingApprovals[selectedTargetId]);
      if (msg.approved) {
        showToast('Accepted! Starting transfer...');
        // ✅ THE FIX: use receiverConnectionId from response
        startWebRTCSend(msg.receiverConnectionId);
      } else {
        showToast('Transfer was declined');
        setProgress(0, false);
      }
      break;
    case 'webrtc-signal':
      handleWebRTCSignal(msg);
      break;
    case 'chat':
      receiveChatMessage(msg);
      break;
  }
}

// ============================================
// Device Rendering
// ============================================
function getDeviceIcon(type) {
  if (type === 'mobile') return '📱';
  if (type === 'tablet') return '📟';
  return '💻';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderDevices(devices) {
  const container = document.getElementById('send-devices');
  if (!container) return;
  if (devices.length === 0) {
    container.innerHTML = '<p class="empty-hint">No devices found — open OyeSwap on another device</p>';
    return;
  }
  container.innerHTML = devices.map(d => `
    <div class="device-pill ${selectedTargetId === d.clientId ? 'selected' : ''}"
         onclick="selectTarget('${d.clientId}','${escapeHtml(d.deviceName)}')">
      <span class="dpill-icon">${getDeviceIcon(d.deviceType)}</span>
      <span class="dpill-name">${escapeHtml(d.deviceName)}</span>
    </div>
  `).join('');
}

function renderConnectedDevices(devices) {
  const container = document.getElementById('connected-devices');
  if (!container) return;
  if (devices.length === 0) {
    container.innerHTML = '<p class="empty-hint">Waiting for devices...</p>';
    return;
  }
  container.innerHTML = devices.map(d => `
    <div class="connected-device-row">
      <span>${getDeviceIcon(d.deviceType)}</span>
      <span>${escapeHtml(d.deviceName)}</span>
      <span class="device-type-badge">${d.deviceType}</span>
    </div>
  `).join('');
}

function populateChatDropdown(devices) {
  const sel = document.getElementById('chat-target');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select a user...</option>' +
    devices.map(d => `<option value="${d.clientId}" ${d.clientId===current?'selected':''}>${escapeHtml(d.deviceName)}</option>`).join('');
}

// ============================================
// Send Flow
// ============================================
let selectedFile = null;
let selectedTargetId = null;
let selectedTargetName = null;

function selectTarget(id, name) {
  selectedTargetId = id;
  selectedTargetName = name;
  const label = document.getElementById('selected-target-label');
  if (label) label.textContent = 'Sending to: ' + name;
  renderDevices(latestDevices);
}

function handleFileSelect(file) {
  if (!file) return;
  selectedFile = file;
  const info = document.getElementById('file-info');
  if (info) {
    info.innerHTML = `<span class="file-chip">📄 ${escapeHtml(file.name)} <em>${formatSize(file.size)}</em></span>`;
  }
}

function sendFile() {
  if (!selectedFile) { showToast('Please select a file first'); return; }
  if (!selectedTargetId) { showToast('Please select a device first'); return; }
  sendWS({
    type: 'request-approval',
    targetClientId: selectedTargetId,
    fileName: selectedFile.name,
    fileSize: selectedFile.size,
    senderName: deviceName
  });
  showToast('Waiting for approval...');
  setProgress(0, true);
  document.getElementById('progress-label').textContent = 'Waiting for approval...';
  pendingApprovals[selectedTargetId] = setTimeout(() => {
    showToast('No response — request timed out');
    setProgress(0, false);
  }, 60000);
}

// ============================================
// Approval Modal
// ============================================
let pendingApprovalMsg = null;

function showApprovalModal(msg) {
  pendingApprovalMsg = msg;
  document.getElementById('modal-sender').textContent = msg.senderName;
  document.getElementById('modal-filename').textContent = msg.fileName;
  document.getElementById('modal-filesize').textContent = formatSize(msg.fileSize);
  document.getElementById('approval-modal').classList.add('active');
}

function acceptTransfer() {
  if (!pendingApprovalMsg) return;
  document.getElementById('approval-modal').classList.remove('active');
  sendWS({
    type: 'approval-response',
    senderConnectionId: pendingApprovalMsg.senderConnectionId,
    approved: true,
    fileName: pendingApprovalMsg.fileName
  });
  prepareWebRTCReceive(pendingApprovalMsg.senderConnectionId);
  pendingApprovalMsg = null;
}

function declineTransfer() {
  if (!pendingApprovalMsg) return;
  document.getElementById('approval-modal').classList.remove('active');
  sendWS({
    type: 'approval-response',
    senderConnectionId: pendingApprovalMsg.senderConnectionId,
    approved: false
  });
  pendingApprovalMsg = null;
}

// ============================================
// WebRTC Sender
// ============================================
async function startWebRTCSend(receiverConnectionId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  peerConnections[receiverConnectionId] = pc;

  const channel = pc.createDataChannel('fileTransfer', { ordered: true });

  channel.onopen = () => {
    document.getElementById('progress-label').textContent = 'Transferring...';
    sendFileOverChannel(channel, selectedFile);
  };
  channel.onerror = () => {
    showToast('Transfer failed');
    setProgress(0, false);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendWS({ type: 'webrtc-signal', targetConnectionId: receiverConnectionId,
        signal: { type: 'ice', candidate: e.candidate } });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendWS({ type: 'webrtc-signal', targetConnectionId: receiverConnectionId,
    signal: { type: 'offer', sdp: offer } });
}

async function sendFileOverChannel(channel, file) {
  const CHUNK = 64 * 1024;
  channel.send(JSON.stringify({
    kind: 'meta', name: file.name, size: file.size,
    totalChunks: Math.ceil(file.size / CHUNK)
  }));

  let offset = 0;
  const sendNext = () => {
    if (offset >= file.size) {
      channel.send(JSON.stringify({ kind: 'done' }));
      showToast('✅ File sent successfully!');
      setProgress(100, false);
      return;
    }
    if (channel.bufferedAmount > CHUNK * 8) { setTimeout(sendNext, 50); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      channel.send(e.target.result);
      offset += CHUNK;
      setProgress((offset / file.size) * 100, true);
      sendNext();
    };
    reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK));
  };
  sendNext();
}

// ============================================
// WebRTC Receiver
// ============================================
function prepareWebRTCReceive(senderConnectionId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  peerConnections[senderConnectionId] = pc;

  let meta = null, chunks = [], received = 0;

  pc.ondatachannel = (e) => {
    const ch = e.channel;
    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data);
        if (msg.kind === 'meta') {
          meta = msg; chunks = []; received = 0;
          setProgress(0, true);
        }
        if (msg.kind === 'done') {
          downloadFile(new Blob(chunks), meta.name);
          showToast('✅ File received: ' + meta.name);
          setProgress(100, false);
          addReceivedFile(meta.name, meta.size);
        }
      } else {
        chunks.push(ev.data);
        received += ev.data.byteLength;
        if (meta) setProgress((received / meta.size) * 100, true);
      }
    };
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendWS({ type: 'webrtc-signal', targetConnectionId: senderConnectionId,
        signal: { type: 'ice', candidate: e.candidate } });
    }
  };
}

async function handleWebRTCSignal(msg) {
  const { signal, fromConnectionId } = msg;
  const pc = peerConnections[fromConnectionId];
  if (!pc) return;

  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWS({ type: 'webrtc-signal', targetConnectionId: fromConnectionId,
      signal: { type: 'answer', sdp: answer } });
  }
  if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  }
  if (signal.type === 'ice') {
    try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
    catch(e) { console.error('ICE error:', e); }
  }
}

// ============================================
// Receive Panel
// ============================================
function addReceivedFile(name, size) {
  const list = document.getElementById('received-files');
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'received-file-item';
  item.innerHTML = `<span>📄 ${escapeHtml(name)}</span><span class="file-size-badge">${formatSize(size)}</span>`;
  list.prepend(item);
  const empty = list.querySelector('.empty-hint');
  if (empty) empty.remove();
}

// ============================================
// Chat
// ============================================
let chatTarget = null;

function sendChat() {
  const input = document.getElementById('chat-input');
  const sel = document.getElementById('chat-target');
  if (!input || !sel || !sel.value || !input.value.trim()) return;
  const msg = input.value.trim().substring(0, 1000);
  sendWS({ type: 'chat', targetClientId: sel.value, message: msg, senderName: deviceName });
  appendChatMessage(msg, deviceName, true);
  input.value = '';
}

function receiveChatMessage(msg) {
  appendChatMessage(msg.message, msg.senderName, false);
}

function appendChatMessage(text, sender, isMine) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + (isMine ? 'mine' : 'theirs');
  div.innerHTML = `${!isMine ? `<span class="bubble-sender">${escapeHtml(sender)}</span>` : ''}
    <span class="bubble-text">${escapeHtml(text)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function burnAll() {
  if (!confirm('Burn all messages? This cannot be undone.')) return;
  document.getElementById('chat-messages').innerHTML = '';
  showToast('🔥 Chat burned');
}

// ============================================
// Helpers
// ============================================
function downloadFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setProgress(pct, show) {
  const wrap = document.getElementById('progress-wrap');
  const bar = document.getElementById('progress-bar');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  if (bar) bar.style.width = Math.min(pct, 100) + '%';
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
  return (b/1073741824).toFixed(1) + ' GB';
}

// ============================================
// Device Name Edit
// ============================================
function editDeviceName() {
  const n = prompt('Enter device name:', deviceName);
  if (n && n.trim()) {
    deviceName = n.trim().substring(0, 24);
    localStorage.setItem('oyeswap-devicename', deviceName);
    document.getElementById('my-device-name').textContent = deviceName;
    sendWS({ type: 'register', clientId, deviceName, deviceType: getDeviceType() });
  }
}

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('my-device-name').textContent = deviceName;

  // File input
  document.getElementById('file-input').addEventListener('change', e => {
    handleFileSelect(e.target.files[0]);
  });

  // Drop zone
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files[0]);
  });

  // Send button
  document.getElementById('send-btn').addEventListener('click', sendFile);

  // Approval buttons
  document.getElementById('accept-btn').addEventListener('click', acceptTransfer);
  document.getElementById('decline-btn').addEventListener('click', declineTransfer);

  // Chat
  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendChat();
  });
  document.getElementById('burn-btn').addEventListener('click', burnAll);

  connectWS();
});