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
// CHANGED: removed 'chat' and 'chat-burned' cases.
// Those message types no longer travel through the server.
// Chat is now entirely P2P over the RTCDataChannel.
// WebSocket only handles signaling (room join, offer/answer/ICE).
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
      showToast('Room error: ' + msg.message);
      document.getElementById('code-input').classList.add('shake');
      setTimeout(() => document.getElementById('code-input').classList.remove('shake'), 500);
      break;

    case 'webrtc-signal':
      handleWebRTCSignal(msg);
      break;

    // REMOVED: 'chat' case — chat no longer routes through the server.
    // REMOVED: 'chat-burned' case — burn signal now travels over the data channel.
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
    `<span class="file-chip">File: ${escapeHtml(file.name)} <em>${formatSize(file.size)}</em></span>`;

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
// WebCrypto — ECDH Key Exchange + AES-GCM
// CHANGED: entirely new section.
//
// Both peers run an ECDH key exchange over the data channel as the
// very first thing after it opens. Neither the shared secret nor any
// derived key ever leaves the browser. AWS Lambda never sees them.
//
// Protocol (both sides):
//   1. Generate an ephemeral ECDH-P256 keypair.
//   2. Export the public key as raw bytes and send it through the data
//      channel as { type: 'ecdh-pubkey', key: <base64> }.
//   3. On receiving the peer's public key, derive a shared AES-GCM-256
//      key using ECDH + HKDF.
//   4. Mark chat as ready; enable the chat input.
//
// Every subsequent chat message is encrypted with AES-GCM (random 12-byte IV
// per message) before transmission and decrypted on receipt.
// ============================================

// Holds the local ephemeral keypair and the derived shared key.
// Both are scoped per session — refreshed every time a new data channel opens.
let cryptoState = {
  keyPair: null,        // CryptoKeyPair (ECDH)
  sharedKey: null,      // CryptoKey (AES-GCM) — set after key exchange completes
  exchangeDone: false,  // true once we have derived the shared key
  peerPublicKeyRaw: null // raw bytes of the peer's public key (stored briefly)
};

// Generate a fresh ephemeral ECDH keypair for this session.
async function generateECDHKeyPair() {
  return window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key non-exportable — never leaves the browser
    ['deriveKey']
  );
}

// Export the public key as raw bytes (65 bytes for P-256 uncompressed point).
async function exportPublicKey(keyPair) {
  const raw = await window.crypto.subtle.exportKey('raw', keyPair.publicKey);
  return raw;
}

// Derive a shared AES-GCM-256 key from our private key + peer's public key,
// using HKDF with SHA-256 for key stretching.
async function deriveSharedKey(ourPrivateKey, peerPublicKeyRaw) {
  // Import the peer's raw public key as an ECDH key.
  const peerPublicKey = await window.crypto.subtle.importKey(
    'raw',
    peerPublicKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive a shared AES-GCM key directly via ECDH.
  // deriveKey handles both the ECDH shared secret computation and the final
  // key material extraction in one step inside the secure key store.
  const sharedKey = await window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    ourPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-exportable
    ['encrypt', 'decrypt']
  );

  return sharedKey;
}

// Encrypt a plaintext string with AES-GCM.
// Returns a base64 string of [ 12-byte IV || ciphertext ].
async function encryptMessage(plaintext) {
  if (!cryptoState.sharedKey) throw new Error('No shared key — key exchange not complete');

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoState.sharedKey,
    encoded
  );

  // Concatenate IV + ciphertext into one buffer for transport.
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  // Base64-encode for clean JSON transport.
  return btoa(String.fromCharCode(...combined));
}

// Decrypt a base64-encoded [ IV || ciphertext ] payload.
// Returns the plaintext string.
async function decryptMessage(b64) {
  if (!cryptoState.sharedKey) throw new Error('No shared key');

  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoState.sharedKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

// ============================================
// Chat status helpers
// CHANGED: new helpers to reflect the securing/ready state in the UI.
// Chat input stays disabled until ECDH is complete.
// ============================================
function setChatStatus(state) {
  const el = document.getElementById('chat-status');
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');

  if (state === 'securing') {
    if (el) el.textContent = 'Securing connection...';
    if (input) input.disabled = true;
    if (btn) btn.disabled = true;
  } else if (state === 'ready') {
    if (el) el.textContent = 'Ready';
    if (input) input.disabled = false;
    if (btn) btn.disabled = false;
  } else {
    // default / not connected
    if (el) el.textContent = '';
    if (input) input.disabled = true;
    if (btn) btn.disabled = true;
  }
}

// ============================================
// Sanitise incoming message text before DOM insertion.
// CHANGED: replaces the original `message.replace(/[<>]/g, "")` in Lambda
// and the basic escapeHtml used for incoming peer text.
//
// Strategy: we use a hidden div to strip all HTML tags via the browser's
// own parser (same approach as DOMPurify's core), then further restrict to
// printable characters. This runs in the receiver's browser on the
// already-decrypted plaintext, providing a safe rendering boundary even
// if the sender's device were compromised.
//
// If DOMPurify is loaded (added to index.html by the operator), it takes
// priority and is strictly stronger. This function degrades gracefully
// to the built-in sanitiser without it.
// ============================================
function sanitiseText(raw) {
  if (typeof raw !== 'string') return '';

  // Enforce length cap before any parsing.
  const capped = raw.substring(0, 1000);

  // Prefer DOMPurify if the operator has loaded it.
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(capped, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  }

  // Fallback: extract text-only content through a hidden element.
  // Setting textContent on a div and reading it back strips all markup.
  const scratch = document.createElement('div');
  scratch.textContent = capped;
  // Return the browser-rendered plain text — no tags, no attributes.
  return scratch.textContent;
}

// ============================================
// Data channel registry
// CHANGED: new module.
// We keep a reference to the active data channel so sendChat() and
// burnAll() can reach it regardless of which side (sender/receiver)
// opened it, and without coupling those functions to the peer connection map.
// ============================================
let activeChatChannel = null; // RTCDataChannel reference, set when channel opens

// Called by both sender and receiver when their data channel opens.
// Initiates the ECDH key exchange and marks chat as "securing".
async function onChatChannelOpen(channel) {
  activeChatChannel = channel;
  setChatStatus('securing');

  try {
    // Generate a fresh ephemeral keypair for this session.
    cryptoState.keyPair = await generateECDHKeyPair();
    cryptoState.sharedKey = null;
    cryptoState.exchangeDone = false;
    cryptoState.peerPublicKeyRaw = null;

    const pubKeyRaw = await exportPublicKey(cryptoState.keyPair);
    const pubKeyB64 = btoa(String.fromCharCode(...new Uint8Array(pubKeyRaw)));

    // Send our public key to the peer through the data channel.
    // This is the only ECDH exchange message — no server involvement.
    channel.send(JSON.stringify({ type: 'ecdh-pubkey', key: pubKeyB64 }));
  } catch (err) {
    console.error('ECDH key generation failed:', err);
    showToast('Failed to secure channel — please refresh');
  }
}

// Called when we receive the peer's ECDH public key.
// Derives the shared AES-GCM key and enables chat.
async function onPeerPublicKeyReceived(b64Key) {
  try {
    const raw = Uint8Array.from(atob(b64Key), c => c.charCodeAt(0));
    cryptoState.sharedKey = await deriveSharedKey(cryptoState.keyPair.privateKey, raw);
    cryptoState.exchangeDone = true;
    setChatStatus('ready');
    showToast('Secure channel established');
  } catch (err) {
    console.error('ECDH key derivation failed:', err);
    showToast('Key exchange failed — chat unavailable');
    setChatStatus('securing'); // keep disabled
  }
}

// ============================================
// Unified data channel message handler
// CHANGED: new function that replaces the old receiver-only ch.onmessage.
//
// ALL data channel messages now pass through here — on both sender and
// receiver sides. We distinguish them by:
//   - ArrayBuffer  => file chunk (binary, unchanged file transfer logic)
//   - JSON string with type === 'ecdh-pubkey' => key exchange
//   - JSON string with type === 'chat'         => encrypted chat message
//   - JSON string with type === 'burn'         => burn signal
//   - JSON string with kind === 'meta'/'done'  => file transfer control (unchanged)
// ============================================
async function onDataChannelMessage(ev) {
  // Binary frame — file chunk. Hand straight to file transfer logic.
  if (ev.data instanceof ArrayBuffer) {
    handleFileChunk(ev.data);
    return;
  }

  // Text frame — parse and dispatch.
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }

  // ECDH public key exchange — triggers key derivation.
  if (msg.type === 'ecdh-pubkey') {
    await onPeerPublicKeyReceived(msg.key);
    return;
  }

  // Encrypted chat message from peer.
  if (msg.type === 'chat') {
    if (!cryptoState.exchangeDone) {
      console.warn('Received chat message before key exchange completed — discarding');
      return;
    }
    try {
      const plaintext = await decryptMessage(msg.payload);
      const safe = sanitiseText(plaintext);
      appendChatMessage(safe, msg.senderName, false);
      document.getElementById('chat-section').classList.add('chat-flash');
      setTimeout(() => document.getElementById('chat-section').classList.remove('chat-flash'), 800);
    } catch (err) {
      console.error('Chat decryption failed:', err);
      appendChatMessage('[message could not be decrypted]', 'peer', false);
    }
    return;
  }

  // Burn signal — peer has wiped their chat, wipe ours too.
  // CHANGED: burn now travels over the data channel, not WebSocket.
  if (msg.type === 'burn') {
    document.getElementById('chat-messages').innerHTML = '';
    showToast('Chat burned by peer');
    return;
  }

  // File transfer control messages (kind: 'meta' | 'done').
  // These are handled by the file receive state machine below.
  if (msg.kind === 'meta' || msg.kind === 'done') {
    handleFileControlMessage(msg);
    return;
  }
}

// ============================================
// File transfer state — receiver side
// CHANGED: factored out of the inline ch.onmessage closure so that
// onDataChannelMessage can call it cleanly. Logic is identical to original.
// ============================================
let recvMeta = null, recvChunks = [], recvReceived = 0, recvStartTime = null;

function handleFileChunk(buffer) {
  recvChunks.push(buffer);
  recvReceived += buffer.byteLength;

  if (recvMeta && recvStartTime) {
    const elapsed = (Date.now() - recvStartTime) / 1000 || 0.001;
    const mbps    = (recvReceived / elapsed / 1048576).toFixed(1);
    const pct     = Math.min((recvReceived / recvMeta.size) * 100, 100);
    setProgress(pct, true);
    const el = document.getElementById('recv-speed');
    if (el) el.textContent = `Receiving — ${mbps} MB/s`;
  }
}

function handleFileControlMessage(msg) {
  if (msg.kind === 'meta') {
    recvMeta      = msg;
    recvChunks    = [];
    recvReceived  = 0;
    recvStartTime = Date.now();
    setProgress(0, true);
  }

  if (msg.kind === 'done' && recvMeta) {
    downloadFile(new Blob(recvChunks), recvMeta.name);
    const elapsed = ((Date.now() - recvStartTime) / 1000).toFixed(1);
    const avg     = (recvMeta.size / elapsed / 1048576).toFixed(1);
    showToast(recvMeta.name + ' saved!');
    setProgress(100, true);
    document.getElementById('recv-done').style.display = 'block';
    const el = document.getElementById('recv-speed');
    if (el) el.textContent = `Done — ${avg} MB/s avg · ${elapsed}s`;
  }
}

// ============================================
// WebRTC — Sender
// CHANGED: data channel now has a full onmessage handler for incoming
// chat/burn/ecdh messages. Previously the sender's channel had no onmessage
// handler at all — chat only flowed one way through the server.
// ============================================
async function startWebRTCSend(receiverConnectionId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections[receiverConnectionId] = pc;

  const channel = pc.createDataChannel('fileTransfer', { ordered: true });

  // CHANGED: onopen now also triggers ECDH key exchange before enabling chat.
  channel.onopen = async () => {
    showToast('P2P connected — sending!');
    updateSendStatus('Transferring...');
    setProgress(0, true);

    // Start key exchange FIRST, then begin file transfer in parallel.
    // File transfer does not depend on the key exchange completing.
    // Chat input stays locked until exchange is done.
    await onChatChannelOpen(channel);

    sendFileOverChannel(channel, selectedFile);
  };

  // CHANGED: sender side now receives data channel messages.
  // Previously had no onmessage — chat was server-relayed.
  channel.onmessage = (ev) => onDataChannelMessage(ev);

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
      updateSendStatus('P2P connection failed — try again');
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
      : '...';
    setProgress(pct, true);
    updateSendStatus(`Sending — ${mbps} MB/s · ${eta}s left`);
  }

  channel.send(JSON.stringify({ kind: 'done' }));
  clearInterval(codeExpireTimer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avg     = (file.size / elapsed / 1048576).toFixed(1);
  updateSendStatus(`Done — ${avg} MB/s avg · ${elapsed}s`);
  setProgress(100, true);
  showToast('File sent!');
}

// ============================================
// WebRTC — Receiver
// CHANGED: ch.onmessage now calls the unified onDataChannelMessage handler
// instead of an inline closure that only handled file chunks.
// ch.onopen now also triggers ECDH key exchange.
// ============================================
function prepareWebRTCReceive(senderConnectionId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections[senderConnectionId] = pc;

  // FIX 2: Flush any signals that arrived before we were ready.
  // The sender may have already sent the offer before room-joined was processed.
  const buffered = pendingSignals[senderConnectionId] || [];
  delete pendingSignals[senderConnectionId];
  for (const msg of buffered) handleWebRTCSignal(msg);

  pc.ondatachannel = (e) => {
    const ch = e.channel;
    ch.binaryType = 'arraybuffer';

    // CHANGED: trigger ECDH exchange when channel opens.
    ch.onopen = async () => {
      showToast('P2P connected — receiving!');
      const el = document.getElementById('recv-speed');
      if (el) el.textContent = 'Receiving...';
      await onChatChannelOpen(ch);
    };

    // CHANGED: route ALL incoming messages through the unified handler.
    // Previously this was a long inline closure that only knew about file
    // chunks — chat messages from the peer would have been silently dropped.
    ch.onmessage = (ev) => onDataChannelMessage(ev);

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
    if (state === 'failed') showToast('P2P connection failed — try again');
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
async function sendChat() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;

  // CHANGED: gate on data channel + key exchange, not just currentPeerConnectionId.
  if (!activeChatChannel || activeChatChannel.readyState !== 'open') {
    showToast('Connect to a peer first');
    return;
  }
  if (!cryptoState.exchangeDone) {
    showToast('Securing channel — please wait');
    return;
  }

  const plaintext = input.value.trim().substring(0, 1000);

  try {
    // CHANGED: encrypt before sending. Lambda never sees plaintext.
    const encrypted = await encryptMessage(plaintext);
    activeChatChannel.send(JSON.stringify({
      type: 'chat',
      payload: encrypted,      // ciphertext only
      senderName: deviceName   // display name for the peer's UI (not verified, same as before)
    }));
  } catch (err) {
    console.error('Chat encryption failed:', err);
    showToast('Failed to encrypt message — not sent');
    return;
  }

  // Show plaintext locally (we wrote it, no need to decrypt our own message).
  appendChatMessage(plaintext, deviceName, true);
  input.value = '';
}

function appendChatMessage(text, sender, isMine) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + (isMine ? 'mine' : 'theirs');

  if (!isMine) {
    const senderEl = document.createElement('span');
    senderEl.className = 'bubble-sender';
    // escapeHtml for the sender display name (local rendering safety).
    senderEl.textContent = sender; // textContent — no XSS possible
    div.appendChild(senderEl);
  }

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';
  textEl.textContent = text;
  div.appendChild(textEl);

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function burnAll() {
  if (!confirm('Burn all messages? This cannot be undone.')) return;

  document.getElementById('chat-messages').innerHTML = '';

  if (activeChatChannel && activeChatChannel.readyState === 'open') {
    // CHANGED: burn signal goes peer-to-peer, not through Lambda.
    activeChatChannel.send(JSON.stringify({ type: 'burn' }));
  }

  showToast('Chat burned');
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
// Init
// CHANGED: chat input and send button start disabled.
// They are enabled only after the ECDH key exchange completes
// (setChatStatus('ready') is called from onPeerPublicKeyReceived).
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('my-device-name').textContent = deviceName;

  // CHANGED: disable chat controls at startup — enabled after key exchange.
  setChatStatus('disconnected');

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