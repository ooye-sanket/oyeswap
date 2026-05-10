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
let iceCandidateQueues = {};  // queued ICE candidates per peer, applied after remote description is set
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
const NUM_CHANNELS = 4;

async function startWebRTCSend(receiverConnectionId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  peerConnections[receiverConnectionId] = pc;

  // Create NUM_CHANNELS parallel data channels
  const channels = [];
  let openCount = 0;

  for (let i = 0; i < NUM_CHANNELS; i++) {
    const ch = pc.createDataChannel('fileTransfer-' + i, { ordered: true });
    channels.push(ch);

    ch.onopen = () => {
      openCount++;
      if (openCount === NUM_CHANNELS) {
        // All channels open — start transfer
        updateSendStatus('Transferring...');
        setProgress(0, true);
        sendFileParallel(channels, selectedFile);
      }
    };

    ch.onerror = () => {
      showToast('Transfer failed — please try again');
      setProgress(0, false);
    };
  }

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

// ── Parallel sender: splits file across N channels ──
async function sendFileParallel(channels, file) {
  const CHUNK      = 256 * 1024;   // 256 KB per chunk
  const BUFFER_HIGH = CHUNK * 16;  // 4 MB high-water mark per channel
  const BUFFER_LOW  = CHUNK * 4;   // 1 MB drain threshold
  const n           = channels.length;

  // Send meta on channel 0 so receiver knows what's coming
  channels[0].send(JSON.stringify({
    kind: 'meta', name: file.name,
    size: file.size, numChannels: n
  }));

  let totalSent = 0;
  let startTime = Date.now();

  // Each channel gets a segment of the file
  const segSize = Math.ceil(file.size / n);

  const waitForDrain = (ch) =>
    new Promise(resolve => { ch.onbufferedamountlow = resolve; });

  const sendSegment = async (ch, startOffset, endOffset, channelIdx) => {
    ch.bufferedAmountLowThreshold = BUFFER_LOW;
    let offset = startOffset;

    while (offset < endOffset) {
      if (ch.bufferedAmount > BUFFER_HIGH) await waitForDrain(ch);

      const end    = Math.min(offset + CHUNK, endOffset);
      const buffer = await file.slice(offset, end).arrayBuffer();

      // Binary header: [channelIdx u8][offset u32] then raw bytes
      const header = new ArrayBuffer(5);
      const view   = new DataView(header);
      view.setUint8(0, channelIdx);
      view.setUint32(1, offset, false);  // big-endian offset

      // Combine header + chunk into one send
      const packet = new Uint8Array(5 + buffer.byteLength);
      packet.set(new Uint8Array(header), 0);
      packet.set(new Uint8Array(buffer), 5);
      ch.send(packet.buffer);

      totalSent += (end - offset);
      offset     = end;

      // Live speed + progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const mbps    = (totalSent / elapsed / 1048576).toFixed(1);
      const pct     = Math.min((totalSent / file.size) * 100, 100);
      const remaining = elapsed > 0.5
        ? ((file.size - totalSent) / (totalSent / elapsed) / 1000).toFixed(0)
        : '…';
      setProgress(pct, true);
      updateSendStatus('Transferring — ' + mbps + ' MB/s · ' + remaining + 's left');
    }
  };

  // Launch all segments in parallel
  const tasks = channels.map((ch, i) =>
    sendSegment(ch, i * segSize, Math.min((i + 1) * segSize, file.size), i)
  );
  await Promise.all(tasks);

  // Signal done on channel 0
  channels[0].send(JSON.stringify({ kind: 'done' }));
  clearInterval(codeExpireTimer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avg     = (file.size / elapsed / 1048576).toFixed(1);
  updateSendStatus('✅ Sent in ' + elapsed + 's · avg ' + avg + ' MB/s');
  setProgress(100, true);
  showToast('✅ File sent!');
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

  let meta         = null;
  let received     = 0;
  let startTime    = null;
  // Collect segments from all channels, keyed by offset
  let segments     = {};
  let channelsDone = 0;

  // StreamSaver: stream chunks directly to disk (no RAM buffering)
  let writer       = null;

  const tryStream  = () => {
    if (!writer) return;
    // Sort all received offsets and write sequentially
    const offsets = Object.keys(segments).map(Number).sort((a, b) => a - b);
    for (const off of offsets) {
      if (segments[off]) {
        writer.write(new Uint8Array(segments[off]));
        delete segments[off];
      }
    }
  };

  pc.ondatachannel = (e) => {
    const ch = e.channel;
    ch.binaryType = 'arraybuffer';

    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data);

        if (msg.kind === 'meta') {
          meta      = msg;
          received  = 0;
          segments  = {};
          startTime = Date.now();
          setProgress(0, true);

          // Open a StreamSaver writable stream if available
          if (window.streamSaver) {
            const fileStream = streamSaver.createWriteStream(msg.name, { size: msg.size });
            writer = fileStream.getWriter();
          }
        }

        if (msg.kind === 'done') {
          channelsDone++;
          const numCh = meta.numChannels || 1;

          if (channelsDone >= numCh) {
            if (writer) {
              tryStream();
              writer.close();
              writer = null;
              showToast('✅ ' + meta.name + ' saved!');
            } else {
              // Fallback: assemble from segments and download
              const sorted  = Object.keys(segments).map(Number).sort((a, b) => a - b);
              const allBufs = sorted.map(k => segments[k]);
              downloadFile(new Blob(allBufs), meta.name);
              showToast('✅ ' + meta.name + ' saved!');
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const avg     = (meta.size / elapsed / 1048576).toFixed(1);
            setProgress(100, true);
            document.getElementById('recv-done').style.display = 'block';
            document.getElementById('receive-status').querySelector('p') &&
              (document.getElementById('recv-done').previousElementSibling.textContent =
                'Received in ' + elapsed + 's · avg ' + avg + ' MB/s');
          }
        }
      } else {
        // Binary packet: [channelIdx u8][offset u32][data...]
        const view     = new DataView(ev.data);
        const offset   = view.getUint32(1, false);
        const data     = ev.data.slice(5);

        segments[offset] = data;
        received        += data.byteLength;

        if (writer) tryStream();

        if (meta) {
          const elapsed = (Date.now() - startTime) / 1000;
          const mbps    = elapsed > 0.1
            ? (received / elapsed / 1048576).toFixed(1)
            : '…';
          const pct     = Math.min((received / meta.size) * 100, 100);
          setProgress(pct, true);
          const el = document.getElementById('receive-status').querySelector('p');
          if (el) el.textContent = 'Receiving — ' + mbps + ' MB/s';
        }
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
    // Flush any ICE candidates that arrived before the offer was processed
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
    // Flush any ICE candidates that arrived before the answer was processed
    const queued = iceCandidateQueues[fromConnectionId] || [];
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('ICE flush:', e); }
    }
    iceCandidateQueues[fromConnectionId] = [];
  }

  if (signal.type === 'ice') {
    if (pc.remoteDescription) {
      // Remote description already set — apply immediately
      try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
      catch (e) { console.error('ICE:', e); }
    } else {
      // Remote description not set yet — queue for later
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