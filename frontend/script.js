// ============================================
// OyeSwap — QR + Code Flow + WebRTC P2P
// ============================================

const WS_URL = CONFIG.WS_URL;

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
let ws, reconnectTimer, keepaliveTimer;
let isConnected = false;

function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    isConnected = true;
    clearTimeout(reconnectTimer);
    updateStatus(true);
    ws.send(JSON.stringify({
      type: 'register', clientId,
      deviceName, deviceType: getDeviceType()
    }));
    keepaliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'ping' }));
    }, 8 * 60 * 1000);
  };

  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    isConnected = false;
    clearInterval(keepaliveTimer);
    updateStatus(false);
    reconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();
}

function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(data));
}

function updateStatus(online) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot) dot.className = 'status-dot ' + (online ? 'online' : 'offline');
  if (txt) txt.textContent = online ? 'Online' : 'Reconnecting...';
}

// ============================================
// Message Handler
// ============================================
let peerConnections = {};
let currentRoomCode = null;
let currentPeerConnectionId = null;

function handleMessage(msg) {
  switch (msg.type) {

    case 'receiver-joined':
      // Sender: receiver has joined, start WebRTC
      currentPeerConnectionId = msg.receiverConnectionId;
      showToast('Receiver connected! Starting transfer...');
      updateSendStatus('Receiver connected — starting transfer...');
      startWebRTCSend(msg.receiverConnectionId);
      break;

    case 'room-joined':
      // Receiver: got room info, start WebRTC receive side
      currentPeerConnectionId = msg.senderConnectionId;
      showReceiveInfo(msg.fileName, msg.fileSize, msg.senderConnectionId);
      prepareWebRTCReceive(msg.senderConnectionId);
      break;

    case 'room-error':
      showToast('❌ ' + msg.message);
      document.getElementById('code-input').classList.add('shake');
      setTimeout(() => document.getElementById('code-input').classList.remove('shake'), 500);
      break;

    case 'webrtc-signal':
      handleWebRTCSignal(msg);
      break;

    case 'chat':
      appendChatMessage(msg.message, msg.senderName, false);
      // Flash chat section
      document.getElementById('chat-section').classList.add('chat-flash');
      setTimeout(() => document.getElementById('chat-section').classList.remove('chat-flash'), 800);
      break;

    case 'chat-burned':
      document.getElementById('chat-messages').innerHTML = '';
      showToast('🔥 Chat burned by peer');
      break;
  }
}

// ============================================
// Room Code Generation
// ============================================
function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateQRUrl(code) {
  const url = `${window.location.origin}?code=${code}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}&bgcolor=16161f&color=7c6af7&qzone=2`;
}

// ============================================
// Send Flow
// ============================================
let selectedFile = null;
let codeExpireTimer = null;

function handleFileSelect(file) {
  if (!file) return;
  selectedFile = file;

  // Show file info
  document.getElementById('file-info').innerHTML =
    `<span class="file-chip">📄 ${escapeHtml(file.name)} <em>${formatSize(file.size)}</em></span>`;

  // Generate room code
  currentRoomCode = generateRoomCode();

  // Show QR + code panel
  showCodePanel(currentRoomCode, file);

  // Register room in backend
  sendWS({
    type: 'create-room',
    roomCode: currentRoomCode,
    fileName: file.name,
    fileSize: file.size
  });

  // Start 5 min countdown
  startCodeExpiry();
}

function showCodePanel(code, file) {
  const panel = document.getElementById('code-panel');
  panel.style.display = 'block';

  // QR code using free QR API (no cost, no account needed)
  document.getElementById('qr-img').src = generateQRUrl(code);
  document.getElementById('room-code-display').textContent = code;
  document.getElementById('send-file-name').textContent = file.name;
  document.getElementById('send-file-size').textContent = formatSize(file.size);

  updateSendStatus('Waiting for receiver to scan or enter code...');
}

function startCodeExpiry() {
  clearInterval(codeExpireTimer);
  let secs = 300;
  const timerEl = document.getElementById('code-timer');

  codeExpireTimer = setInterval(() => {
    secs--;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (timerEl) timerEl.textContent = `Expires in ${m}:${s.toString().padStart(2,'0')}`;

    if (secs <= 0) {
      clearInterval(codeExpireTimer);
      cancelSend();
      showToast('Code expired — please select file again');
    }
  }, 1000);
}

function cancelSend() {
  clearInterval(codeExpireTimer);
  selectedFile = null;
  currentRoomCode = null;
  document.getElementById('code-panel').style.display = 'none';
  document.getElementById('file-info').innerHTML = '';
  document.getElementById('send-status').textContent = '';
  setProgress(0, false);
}

function updateSendStatus(msg) {
  const el = document.getElementById('send-status');
  if (el) el.textContent = msg;
}

// ============================================
// Receive Flow
// ============================================
function joinRoom() {
  const input = document.getElementById('code-input');
  const code = input.value.trim();
  if (code.length !== 6 || !/^\d+$/.test(code)) {
    showToast('Please enter a valid 6-digit code');
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 500);
    return;
  }
  sendWS({ type: 'join-room', roomCode: code });
  document.getElementById('join-btn').textContent = 'Connecting...';
  document.getElementById('join-btn').disabled = true;
}

function showReceiveInfo(fileName, fileSize, senderConnectionId) {
  document.getElementById('receive-status').style.display = 'block';
  document.getElementById('recv-filename').textContent = fileName;
  document.getElementById('recv-filesize').textContent = formatSize(fileSize);
  document.getElementById('join-btn').textContent = 'Receive';
  document.getElementById('join-btn').disabled = false;
  showToast('Connected! Receiving ' + fileName + '...');
}

// ============================================
// WebRTC — Sender
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
    updateSendStatus('Transferring...');
    setProgress(0, true);
    sendFileOverChannel(channel, selectedFile);
  };

  channel.onerror = () => {
    showToast('Transfer failed — please try again');
    setProgress(0, false);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) sendWS({
      type: 'webrtc-signal',
      targetConnectionId: receiverConnectionId,
      signal: { type: 'ice', candidate: e.candidate }
    });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendWS({
    type: 'webrtc-signal',
    targetConnectionId: receiverConnectionId,
    signal: { type: 'offer', sdp: offer }
  });
}

async function sendFileOverChannel(channel, file) {
  const CHUNK = 64 * 1024;
  channel.send(JSON.stringify({
    kind: 'meta', name: file.name,
    size: file.size, totalChunks: Math.ceil(file.size / CHUNK)
  }));

  let offset = 0;
  const sendNext = () => {
    if (offset >= file.size) {
      channel.send(JSON.stringify({ kind: 'done' }));
      clearInterval(codeExpireTimer);
      updateSendStatus('✅ File sent successfully!');
      setProgress(100, true);
      showToast('✅ File sent!');
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
// WebRTC — Receiver
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
          showToast('✅ ' + meta.name + ' saved!');
          setProgress(100, true);
          document.getElementById('recv-done').style.display = 'block';
        }
      } else {
        chunks.push(ev.data);
        received += ev.data.byteLength;
        if (meta) setProgress((received / meta.size) * 100, true);
      }
    };
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) sendWS({
      type: 'webrtc-signal',
      targetConnectionId: senderConnectionId,
      signal: { type: 'ice', candidate: e.candidate }
    });
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
    sendWS({
      type: 'webrtc-signal',
      targetConnectionId: fromConnectionId,
      signal: { type: 'answer', sdp: answer }
    });
  }
  if (signal.type === 'answer')
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  if (signal.type === 'ice') {
    try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
    catch (e) { console.error('ICE:', e); }
  }
}

// ============================================
// Chat
// ============================================
function sendChat() {
  const input = document.getElementById('chat-input');
  if (!input.value.trim() || !currentPeerConnectionId) {
    if (!currentPeerConnectionId) showToast('Connect to a peer first');
    return;
  }
  const msg = input.value.trim().substring(0, 1000);
  sendWS({
    type: 'chat',
    targetConnectionId: currentPeerConnectionId,
    message: msg,
    senderName: deviceName
  });
  appendChatMessage(msg, deviceName, true);
  input.value = '';
}

function appendChatMessage(text, sender, isMine) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + (isMine ? 'mine' : 'theirs');
  div.innerHTML = (!isMine ? `<span class="bubble-sender">${escapeHtml(sender)}</span>` : '') +
    `<span class="bubble-text">${escapeHtml(text)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function burnAll() {
  if (!confirm('Burn all messages? This cannot be undone.')) return;
  document.getElementById('chat-messages').innerHTML = '';
  if (currentPeerConnectionId) {
    sendWS({ type: 'burn-chat', targetConnectionId: currentPeerConnectionId });
  }
  showToast('🔥 Chat burned');
}

// ============================================
// URL Code Auto-fill (QR scan)
// ============================================
function checkURLCode() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    document.getElementById('code-input').value = code;
    // Scroll to receive section
    document.getElementById('panel-receive').scrollIntoView({ behavior: 'smooth' });
    showToast('Code detected — click Receive!');
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }
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
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

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
    e.preventDefault();
    dz.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files[0]);
  });

  // Receive
  document.getElementById('join-btn').addEventListener('click', joinRoom);
  document.getElementById('code-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') joinRoom();
  });

  // Chat
  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendChat();
  });
  document.getElementById('burn-btn').addEventListener('click', burnAll);

  // Check URL for QR code
  checkURLCode();

  // Connect
  connectWS();
});