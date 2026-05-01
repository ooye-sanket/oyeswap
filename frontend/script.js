// ============================================
// OyeSwap - WebRTC + AWS WebSocket
// ============================================

let ws;
let clientId = localStorage.getItem('oyeswap-clientid');
if (!clientId) {
  clientId = 'device-' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('oyeswap-clientid', clientId);
}

const deviceName = localStorage.getItem('oyeswap-devicename') || generateDeviceName();
function generateDeviceName() {
  const adjectives = ['Swift', 'Brave', 'Calm', 'Dark', 'Epic'];
  const nouns = ['Tiger', 'Eagle', 'Storm', 'Nova', 'Bolt'];
  const name = adjectives[Math.floor(Math.random()*adjectives.length)] + 
               nouns[Math.floor(Math.random()*nouns.length)];
  localStorage.setItem('oyeswap-devicename', name);
  return name;
}

// Device type detection
function getDeviceType() {
  const ua = navigator.userAgent;
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  return 'desktop';
}

// ============================================
// WebSocket Connection
// ============================================

let reconnectTimer;
let isConnected = false;

function connectWS() {
  ws = new WebSocket(CONFIG.WS_URL);

  ws.onopen = () => {
    isConnected = true;
    clearTimeout(reconnectTimer);
    console.log('Connected to signaling server');
    
    // Register this device
    ws.send(JSON.stringify({
      type: 'register',
      clientId,
      deviceName,
      deviceType: getDeviceType()
    }));
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } 
    catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    isConnected = false;
    console.log('Disconnected — reconnecting in 3s...');
    reconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = (err) => {
    console.error('WS error:', err);
    ws.close();
  };
}

function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ============================================
// Message Handler
// ============================================

let pendingApprovals = {};
let peerConnections = {};
let latestDevices = [];

function handleMessage(msg) {
  switch(msg.type) {

    case 'devices':
      latestDevices = msg.list || [];
      renderDevices(latestDevices);
      break;

    case 'approval-request':
      showApprovalModal(msg);
      break;

    case 'approval-result':
      if (msg.approved) {
        startWebRTCSend(msg);
      } else {
        showToast('Transfer declined');
        hideProgress();
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

function renderDevices(devices) {
  const container = document.getElementById('devices-container') || 
                    document.querySelector('.devices-grid');
  if (!container) return;

  // Filter out self
  const others = devices.filter(d => d.clientId !== clientId);

  if (others.length === 0) {
    container.innerHTML = `
      <div class="no-devices">
        <p>No other devices nearby</p>
        <p class="hint">Open OyeSwap on another device</p>
      </div>`;
    return;
  }

  container.innerHTML = others.map(device => `
    <div class="device-card" onclick="selectDevice('${device.clientId}', '${device.deviceName}')">
      <div class="device-icon">${getDeviceIcon(device.deviceType)}</div>
      <div class="device-name">${escapeHtml(device.deviceName)}</div>
      <div class="device-type">${device.deviceType}</div>
    </div>
  `).join('');
}

function getDeviceIcon(type) {
  if (type === 'mobile') return '📱';
  if (type === 'tablet') return '📟';
  return '💻';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// File Transfer — Send Side
// ============================================

let selectedFile = null;
let selectedTargetId = null;
let selectedTargetName = null;

function selectDevice(targetClientId, targetName) {
  selectedTargetId = targetClientId;
  selectedTargetName = targetName;
  
  // Highlight selected device
  document.querySelectorAll('.device-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  
  // Show file picker area
  const sendArea = document.getElementById('send-area');
  if (sendArea) {
    sendArea.style.display = 'block';
    sendArea.querySelector('.target-name').textContent = targetName;
  }
}

function handleFileSelect(file) {
  if (!file) return;
  selectedFile = file;
  
  const fileInfo = document.getElementById('file-info');
  if (fileInfo) {
    fileInfo.textContent = `${file.name} (${formatSize(file.size)})`;
  }
}

function sendFile() {
  if (!selectedFile) { showToast('Please select a file'); return; }
  if (!selectedTargetId) { showToast('Please select a device'); return; }

  // Request approval from receiver
  sendWS({
    type: 'request-approval',
    targetClientId: selectedTargetId,
    fileName: selectedFile.name,
    fileSize: selectedFile.size,
    senderName: deviceName
  });

  showToast('Waiting for approval...');
  showProgress(0);

  // Timeout if no response in 60 seconds
  pendingApprovals[selectedTargetId] = setTimeout(() => {
    showToast('No response from receiver');
    hideProgress();
  }, 60000);
}

// ============================================
// Approval Modal — Receiver Side  
// ============================================

let pendingApprovalMsg = null;

function showApprovalModal(msg) {
  pendingApprovalMsg = msg;
  
  const modal = document.getElementById('approval-modal');
  if (!modal) return;

  modal.querySelector('.sender-name').textContent = msg.senderName;
  modal.querySelector('.file-name').textContent = msg.fileName;
  modal.querySelector('.file-size').textContent = formatSize(msg.fileSize);
  modal.style.display = 'flex';
}

function acceptTransfer() {
  if (!pendingApprovalMsg) return;
  
  document.getElementById('approval-modal').style.display = 'none';

  sendWS({
    type: 'approval-response',
    senderConnectionId: pendingApprovalMsg.senderConnectionId,
    approved: true,
    fileName: pendingApprovalMsg.fileName
  });

  // Prepare to receive WebRTC connection
  prepareWebRTCReceive(pendingApprovalMsg.senderConnectionId);
  pendingApprovalMsg = null;
}

function declineTransfer() {
  if (!pendingApprovalMsg) return;
  
  document.getElementById('approval-modal').style.display = 'none';

  sendWS({
    type: 'approval-response',
    senderConnectionId: pendingApprovalMsg.senderConnectionId,
    approved: false,
    fileName: pendingApprovalMsg.fileName
  });

  pendingApprovalMsg = null;
}

// ============================================
// WebRTC — Sender Side
// ============================================

async function startWebRTCSend(msg) {
  clearTimeout(pendingApprovals[selectedTargetId]);

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  peerConnections[msg.senderConnectionId] = pc;

  // Create data channel
  const channel = pc.createDataChannel('fileTransfer', {
    ordered: true
  });

  channel.onopen = () => {
    console.log('Data channel open — starting transfer');
    sendFileOverChannel(channel, selectedFile);
  };

  channel.onerror = (e) => {
    console.error('Channel error:', e);
    showToast('Transfer failed');
    hideProgress();
  };

  // ICE candidates
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendWS({
        type: 'webrtc-signal',
        targetConnectionId: msg.senderConnectionId,
        signal: { type: 'ice', candidate: e.candidate }
      });
    }
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  sendWS({
    type: 'webrtc-signal',
    targetConnectionId: msg.senderConnectionId,
    signal: { type: 'offer', sdp: offer }
  });
}

async function sendFileOverChannel(channel, file) {
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  
  // Send file metadata first
  channel.send(JSON.stringify({
    kind: 'meta',
    name: file.name,
    size: file.size,
    totalChunks
  }));

  let offset = 0;
  let chunkIndex = 0;

  const sendNextChunk = () => {
    if (offset >= file.size) {
      channel.send(JSON.stringify({ kind: 'done' }));
      showToast('Transfer complete!');
      hideProgress();
      return;
    }

    // Wait if buffer is full
    if (channel.bufferedAmount > CHUNK_SIZE * 8) {
      setTimeout(sendNextChunk, 50);
      return;
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      channel.send(e.target.result);
      offset += CHUNK_SIZE;
      chunkIndex++;
      
      const progress = Math.min((offset / file.size) * 100, 100);
      showProgress(progress);
      sendNextChunk();
    };
    
    reader.readAsArrayBuffer(slice);
  };

  sendNextChunk();
}

// ============================================
// WebRTC — Receiver Side
// ============================================

function prepareWebRTCReceive(senderConnectionId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  peerConnections[senderConnectionId] = pc;

  let receivedMeta = null;
  let receivedChunks = [];
  let receivedSize = 0;

  pc.ondatachannel = (event) => {
    const channel = event.channel;

    channel.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        
        if (msg.kind === 'meta') {
          receivedMeta = msg;
          receivedChunks = [];
          receivedSize = 0;
          showProgress(0);
          showToast(`Receiving ${msg.name}...`);
        }
        
        if (msg.kind === 'done') {
          const blob = new Blob(receivedChunks);
          downloadFile(blob, receivedMeta.name);
          showToast('File received!');
          hideProgress();
          receivedChunks = [];
        }
      } else {
        // Binary chunk
        receivedChunks.push(e.data);
        receivedSize += e.data.byteLength;
        
        if (receivedMeta) {
          const progress = (receivedSize / receivedMeta.size) * 100;
          showProgress(Math.min(progress, 100));
        }
      }
    };
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendWS({
        type: 'webrtc-signal',
        targetConnectionId: senderConnectionId,
        signal: { type: 'ice', candidate: e.candidate }
      });
    }
  };
}

async function handleWebRTCSignal(msg) {
  const { signal, fromConnectionId } = msg;
  let pc = peerConnections[fromConnectionId];

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

  if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  }

  if (signal.type === 'ice') {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch(e) {
      console.error('ICE error:', e);
    }
  }
}

// ============================================
// File Download Helper
// ============================================

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================
// Chat
// ============================================

function sendChat(targetClientId, message) {
  if (!message.trim()) return;
  const safe = message.substring(0, 1000);
  
  sendWS({
    type: 'chat',
    targetClientId,
    message: safe,
    senderName: deviceName
  });
}

function receiveChatMessage(msg) {
  const chatBox = document.getElementById('chat-messages');
  if (!chatBox) return;

  const div = document.createElement('div');
  div.className = 'chat-message received';
  div.innerHTML = `
    <span class="chat-sender">${escapeHtml(msg.senderName)}</span>
    <span class="chat-text">${escapeHtml(msg.message)}</span>
  `;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ============================================
// UI Helpers
// ============================================

function showProgress(percent) {
  const bar = document.getElementById('progress-bar');
  const wrap = document.getElementById('progress-wrap');
  if (wrap) wrap.style.display = 'block';
  if (bar) bar.style.width = percent + '%';
}

function hideProgress() {
  const wrap = document.getElementById('progress-wrap');
  if (wrap) wrap.style.display = 'none';
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/(1024*1024)).toFixed(1) + ' MB';
  return (bytes/(1024*1024*1024)).toFixed(1) + ' GB';
}

// ============================================
// Drag and Drop + File Input
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Show device name
  const nameEl = document.getElementById('device-name');
  if (nameEl) nameEl.textContent = deviceName;

  // File input
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFileSelect(e.target.files[0]);
    });
  }

  // Drag and drop
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFileSelect(e.dataTransfer.files[0]);
    });
  }

  // Send button
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.addEventListener('click', sendFile);

  // Approval buttons
  const acceptBtn = document.getElementById('accept-btn');
  const declineBtn = document.getElementById('decline-btn');
  if (acceptBtn) acceptBtn.addEventListener('click', acceptTransfer);
  if (declineBtn) declineBtn.addEventListener('click', declineTransfer);

  // Chat send
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', () => {
      const targetSelect = document.getElementById('chat-target');
      if (targetSelect && chatInput.value.trim()) {
        sendChat(targetSelect.value, chatInput.value);
        chatInput.value = '';
      }
    });
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') chatSendBtn.click();
    });
  }

  // Connect to WebSocket
  connectWS();
});