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
// ICE servers — STUN + free TURN relay fallback
// FIX 1: Without TURN, symmetric NAT peers hang forever.
// Open Relay is free, no sign-up needed.
// ============================================
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

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
let iceCandidateQueues = {};  // ICE candidates queued before remote desc is set
let pendingSignals = {};      // FIX 2: signals buffered before prepareWebRTCReceive runs
let currentRoomCode = null;
let currentPeerConnectionId = null;

function handleMessage(msg) {
  switch (msg.type) {

    case 'receiver-joined':
      // Receiver joined at WebSocket level — WebRTC not connected yet.
      // DO NOT say "starting transfer" here; the channel hasn't opened.
      currentPeerConnectionId = msg.receiverConnectionId;
      showToast('Receiver joined — connecting P2P...');
      updateSendStatus('Receiver joined — negotiating connection...');
      startWebRTCSend(msg.receiverConnectionId);
      break;

    case 'room-joined':
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

  document.getElementById('file-info').innerHTML =
    `<span class="file-chip">📄 ${escapeHtml(file.name)} <em>${formatSize(file.size)}</em></span>`;

  currentRoomCode = generateRoomCode();
  showCodePanel(currentRoomCode, file);

  sendWS({
    type: 'create-room',
    roomCode: currentRoomCode,
    fileName: file.name,
    fileSize: file.size
  });

  startCodeExpiry();
}

function showCodePanel(code, file) {
  const panel = document.getElementById('code-panel');
  panel.style.display = 'block';
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
  showToast('Room joined — connecting P2P...');
}

// ============================================
// WebRTC — Sender
// ============================================
async function startWebRTCSend(receiverConnectionId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections[receiverConnectionId] = pc;

  const channel = pc.createDataChannel('fileTransfer', { ordered: true });

  // FIX: only show "transferring" when the data channel actually opens
  channel.onopen = () => {
    showToast('P2P connected — sending!');
    updateSendStatus('Transferring...');
    setProgress(0, true);
    sendFileOverChannel(channel, selectedFile);
  };

  channel.onerror = (e) => {
    console.error('Data channel error (sender):', e);
    showToast('Transfer failed — please try again');
    setProgress(0, false);
  };

  // Show real ICE state so user knows what's happening
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log('ICE state (sender):', state);
    if (state === 'checking')
      updateSendStatus('Finding peer-to-peer route...');
    if (state === 'connected' || state === 'completed')
      updateSendStatus('P2P connected — opening channel...');
    if (state === 'failed')
      updateSendStatus('❌ P2P connection failed — try again');
    if (state === 'disconnected')
      updateSendStatus('Connection lost...');
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
  const CHUNK       = 256 * 1024;  // 256 KB
  const BUFFER_HIGH = CHUNK * 16;  // 4 MB high-water: pause
  const BUFFER_LOW  = CHUNK * 4;   // 1 MB drain threshold: resume
  channel.bufferedAmountLowThreshold = BUFFER_LOW;

  channel.send(JSON.stringify({ kind: 'meta', name: file.name, size: file.size }));

  let offset    = 0;
  let startTime = Date.now();

  // FIX 3: addEventListener + { once: true } — never misses the drain event.
  // Also check AFTER send so a fast drain cannot race past the listener setup.
  const waitForDrain = () => new Promise(resolve => {
    if (channel.bufferedAmount <= BUFFER_LOW) { resolve(); return; }
    channel.addEventListener('bufferedamountlow', resolve, { once: true });
  });

  while (offset < file.size) {
    const slice  = file.slice(offset, offset + CHUNK);
    const buffer = await slice.arrayBuffer();
    channel.send(buffer);
    offset += buffer.byteLength;  // use actual bytes sent, not CHUNK

    // Backpressure after send (not before — avoids the pre-drain race)
    if (channel.bufferedAmount > BUFFER_HIGH) await waitForDrain();

    const sent    = Math.min(offset, file.size);
    const elapsed = (Date.now() - startTime) / 1000 || 0.001;
    const mbps    = (sent / elapsed / 1048576).toFixed(1);
    const pct     = Math.min((sent / file.size) * 100, 100);
    const eta     = elapsed > 0.3
      ? Math.ceil((file.size - sent) / (sent / elapsed) / 1000)
      : '…';
    setProgress(pct, true);
    updateSendStatus(`Sending — ${mbps} MB/s · ${eta}s left`);
  }

  channel.send(JSON.stringify({ kind: 'done' }));
  clearInterval(codeExpireTimer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avg     = (file.size / elapsed / 1048576).toFixed(1);
  updateSendStatus(`✅ Done — ${avg} MB/s avg · ${elapsed}s`);
  setProgress(100, true);
  showToast('✅ File sent!');
}

// ============================================
// WebRTC — Receiver
// ============================================
function prepareWebRTCReceive(senderConnectionId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections[senderConnectionId] = pc;

  // FIX 2: Flush any signals that arrived before we were ready.
  // The sender may have already sent the offer before room-joined was processed.
  const buffered = pendingSignals[senderConnectionId] || [];
  delete pendingSignals[senderConnectionId];
  for (const msg of buffered) handleWebRTCSignal(msg);

  let meta = null, chunks = [], received = 0, startTime = null;

  pc.ondatachannel = (e) => {
    const ch = e.channel;
    ch.binaryType = 'arraybuffer';

    ch.onopen = () => {
      showToast('P2P connected — receiving!');
      const el = document.getElementById('recv-speed');
      if (el) el.textContent = 'Receiving...';
    };

    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data);

        if (msg.kind === 'meta') {
          meta      = msg;
          chunks    = [];
          received  = 0;
          startTime = Date.now();
          setProgress(0, true);
        }

        if (msg.kind === 'done' && meta) {
          downloadFile(new Blob(chunks), meta.name);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const avg     = (meta.size / elapsed / 1048576).toFixed(1);
          showToast('✅ ' + meta.name + ' saved!');
          setProgress(100, true);
          document.getElementById('recv-done').style.display = 'block';
          const el = document.getElementById('recv-speed');
          if (el) el.textContent = `✅ Done — ${avg} MB/s avg · ${elapsed}s`;
        }
      } else {
        chunks.push(ev.data);
        received += ev.data.byteLength;

        if (meta && startTime) {
          const elapsed = (Date.now() - startTime) / 1000 || 0.001;
          const mbps    = (received / elapsed / 1048576).toFixed(1);
          const pct     = Math.min((received / meta.size) * 100, 100);
          setProgress(pct, true);
          const el = document.getElementById('recv-speed');
          if (el) el.textContent = `Receiving — ${mbps} MB/s`;
        }
      }
    };

    ch.onerror = (e) => {
      console.error('Data channel error (receiver):', e);
      showToast('Transfer error — please try again');
    };
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log('ICE state (receiver):', state);
    const el = document.getElementById('recv-speed');
    if (state === 'checking' && el) el.textContent = 'Finding peer-to-peer route...';
    if (state === 'failed') showToast('❌ P2P connection failed — try again');
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

  if (!pc) {
    // FIX 2: pc not ready yet — buffer and replay when prepareWebRTCReceive runs
    if (!pendingSignals[fromConnectionId]) pendingSignals[fromConnectionId] = [];
    pendingSignals[fromConnectionId].push(msg);
    return;
  }

  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const queued = iceCandidateQueues[fromConnectionId] || [];
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('ICE flush:', e); }
    }
    iceCandidateQueues[fromConnectionId] = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWS({
      type: 'webrtc-signal',
      targetConnectionId: fromConnectionId,
      signal: { type: 'answer', sdp: answer }
    });
  }

  if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const queued = iceCandidateQueues[fromConnectionId] || [];
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('ICE flush:', e); }
    }
    iceCandidateQueues[fromConnectionId] = [];
  }

  if (signal.type === 'ice') {
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
      catch (e) { console.error('ICE:', e); }
    } else {
      if (!iceCandidateQueues[fromConnectionId]) iceCandidateQueues[fromConnectionId] = [];
      iceCandidateQueues[fromConnectionId].push(signal.candidate);
    }
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
    document.getElementById('panel-receive').scrollIntoView({ behavior: 'smooth' });
    showToast('Code detected — click Receive!');
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
  const bar  = document.getElementById('progress-bar');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  if (bar)  bar.style.width    = Math.min(pct, 100) + '%';
  const rWrap = document.getElementById('recv-progress-wrap');
  const rBar  = document.getElementById('progress-bar-recv');
  if (rWrap) rWrap.style.display = show ? 'block' : 'none';
  if (rBar)  rBar.style.width    = Math.min(pct, 100) + '%';
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

  document.getElementById('file-input').addEventListener('change', e => {
    handleFileSelect(e.target.files[0]);
  });

  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files[0]);
  });

  document.getElementById('join-btn').addEventListener('click', joinRoom);
  document.getElementById('code-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') joinRoom();
  });

  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendChat();
  });
  document.getElementById('burn-btn').addEventListener('click', burnAll);

  checkURLCode();
  connectWS();
});
