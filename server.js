import express from "express";
import cors from "cors";
import multer from "multer";
import http from "http";
import { Server as SocketServer } from "socket.io";
import dotenv from "dotenv";
import os from "os";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

dotenv.config();

const app = express();
const server = http.createServer(app);

// 🔒 SECURITY: Helmet for HTTP headers protection
app.use(helmet({
  contentSecurityPolicy: false, // Allow socket.io
  crossOriginEmbedderPolicy: false
}));

// 🔒 SECURITY: Rate limiting (prevent spam/abuse)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per 15 min
  message: 'Too many requests, please try again later.'
});
app.use('/upload', limiter);

// 🔒 SECURITY: File upload rate limit (stricter)
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Max 20 uploads per 5 min
  message: 'Too many file uploads, please slow down.'
});

const io = new SocketServer(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  upgradeTimeout: 30000,
  allowEIO3: true
});

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || "*",
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static("public"));
app.use('/media', express.static("media"));

// 🔒 SECURITY: Validate file types (block dangerous files)
const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.dll', '.scr', '.vbs', '.js', '.msi'];
const ALLOWED_MIME_TYPES = [
  'image/', 'video/', 'audio/', 'application/pdf', 'application/zip',
  'application/x-zip-compressed', 'application/msword', 'application/vnd.',
  'text/', 'application/json', 'application/xml'
];

function isFileAllowed(filename, mimetype) {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

  // Block dangerous extensions
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return false;
  }

  // Allow common safe types
  return ALLOWED_MIME_TYPES.some(type => mimetype.startsWith(type));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB
    files: 10
  },
  fileFilter: (req, file, cb) => {
    // 🔒 SECURITY: File validation
    if (!isFileAllowed(file.originalname, file.mimetype)) {
      return cb(new Error('File type not allowed for security reasons'));
    }
    cb(null, true);
  }
});

const devices = new Map();
const connectionAttempts = new Map(); // Track connection attempts

// 🔒 SECURITY: Prevent connection spam
function checkConnectionLimit(socketId) {
  const now = Date.now();
  const attempts = connectionAttempts.get(socketId) || [];

  // Remove old attempts (older than 1 minute)
  const recentAttempts = attempts.filter(time => now - time < 60000);

  if (recentAttempts.length >= 10) {
    return false; // Too many connections
  }

  recentAttempts.push(now);
  connectionAttempts.set(socketId, recentAttempts);
  return true;
}

function clientIdToSocketId(clientId) {
  for (const [socketId, info] of devices.entries()) {
    if (info.clientId === clientId) return socketId;
  }
  return null;
}

const pendingQueue = new Map();
const chatRooms = new Map();
io.on("connection", (socket) => {
  // 🔒 SECURITY: Check connection rate
  if (!checkConnectionLimit(socket.id)) {
    console.log('⚠️ Connection rejected: Too many attempts from', socket.id);
    socket.disconnect();
    return;
  }

  console.log("Connected:", socket.id);

  socket.on("register", ({ name, clientId }) => {
    // 🔒 SECURITY: Validate input
    if (!name || typeof name !== 'string' || name.length > 50) {
      socket.emit('error', 'Invalid device name');
      return;
    }

    if (!clientId || typeof clientId !== 'string' || clientId.length > 100) {
      socket.emit('error', 'Invalid client ID');
      return;
    }

    // 🔒 SECURITY: Sanitize name (prevent XSS)
    const sanitizedName = name.replace(/[<>]/g, '').trim();

    devices.set(socket.id, {
      name: sanitizedName || "Unknown",
      clientId: clientId,
      connectedAt: Date.now()
    });

    io.emit("devices", getDevices());

    if (clientId) {
      const queued = pendingQueue.get(clientId);
      if (queued && queued.length > 0) {
        console.log(`📦 Delivering ${queued.length} queued file(s) to ${clientId}`);
        queued.forEach((item) => {
          const buffer = Buffer.from(item.fileBufferBase64, 'base64');
          streamFileToSocket(socket.id, item.fileName, item.fileType, item.from, buffer);
        });
        pendingQueue.delete(clientId);
      }
    }
  });

  socket.on("disconnect", () => {
    devices.delete(socket.id);
    io.emit("devices", getDevices());
    console.log("Disconnected:", socket.id);
  });
  /* ========================================
     EPHEMERAL CHAT HANDLERS (RAM ONLY)
     ======================================== */

  // Store active chat rooms (in RAM only)
  // const chatRooms = new Map(); // roomId -> {messages: [], createdAt, members: Set}


  // Join chat room
  socket.on("join-chat-room", (data) => {
    const { roomId, userName } = data;

    if (!roomId || typeof roomId !== 'string') return;

    socket.join(roomId);

    // Initialize room if doesn't exist
    if (!chatRooms.has(roomId)) {
      chatRooms.set(roomId, {
        messages: [],
        createdAt: Date.now(),
        members: new Set()
      });
    }

    const room = chatRooms.get(roomId);
    room.members.add(socket.id);

    // FIX: Send chat history to the newly joined user
    if (room.messages.length > 0) {
      socket.emit("chat-history", {
        roomId,
        messages: room.messages
      });
    }

    // Notify room members (except the one who just joined)
    socket.to(roomId).emit("user-joined-chat", {
      roomId,
      userName: userName || "Unknown",
      timestamp: Date.now()
    });

    console.log(`📨 ${userName} joined chat room: ${roomId}`);
  });

  // Handle chat message
  socket.on("chat-message", (message) => {
    if (!message.roomId) return;

    // 🔒 SECURITY: Validate message
    if (!message.text || typeof message.text !== 'string' || message.text.length > 5000) {
      socket.emit('error', 'Invalid message');
      return;
    }

    // 🔒 SECURITY: Sanitize text (prevent XSS)
    message.text = message.text.replace(/[<>]/g, '');

    const room = chatRooms.get(message.roomId);
    if (room) {
      // Store in RAM with expiry
      room.messages.push({
        ...message,
        expiresAt: Date.now() + (3 * 60 * 60 * 1000) // 3 hours
      });

      // Broadcast to room (including sender for confirmation)
      socket.to(message.roomId).emit("chat-message", message);
    }
  });

  // Handle burn chat
  socket.on("burn-chat", (data) => {
    const { roomId } = data;
    if (!roomId) return;

    const room = chatRooms.get(roomId);
    if (room) {
      room.messages = []; // Clear all messages

      // Notify all room members
      io.to(roomId).emit("chat-burned", { roomId });

      console.log(` Chat burned in room: ${roomId}`);
    }
  });

  // Handle leave chat
  socket.on("leave-chat-room", (data) => {
    const { roomId, userName } = data;
    if (!roomId) return;

    socket.leave(roomId);

    const room = chatRooms.get(roomId);
    if (room) {
      room.members.delete(socket.id);

      // Notify room
      io.to(roomId).emit("user-left-chat", {
        roomId,
        userName: userName || "Unknown",
        timestamp: Date.now()
      });

      console.log(`👋 ${userName} left chat room: ${roomId}`);
    }
  });

  // Cleanup when user disconnects
  socket.on("disconnect", () => {
    // Remove from all chat rooms
    for (const [roomId, room] of chatRooms.entries()) {
      if (room.members.has(socket.id)) {
        room.members.delete(socket.id);

        const deviceInfo = devices.get(socket.id);
        io.to(roomId).emit("user-left-chat", {
          roomId,
          userName: deviceInfo?.name || "Unknown",
          timestamp: Date.now()
        });
      }
    }
  });

  // NEW: Handle file approval requests
  socket.on("request-file-approval", (data) => {
    const targetSocket = clientIdToSocketId(data.toClientId);
    if (targetSocket) {
      io.to(targetSocket).emit("file-approval-request", {
        requestId: data.requestId,
        fromName: data.fromName,
        fromClientId: data.fromClientId,
        files: data.files,
        totalSize: data.totalSize
      });
    }
  });

  // NEW: Handle approval response
  socket.on("file-approval-response", (data) => {
    const senderSocket = clientIdToSocketId(data.fromClientId);
    if (senderSocket) {
      io.to(senderSocket).emit("file-approved", {
        requestId: data.requestId,
        approved: data.approved,
        toClientId: data.toClientId
      });
    }
  });
});

function getDevices() {
  return [...devices.entries()].map(([socketId, data]) => ({
    socketId,
    clientId: data.clientId,
    name: data.name
  }));
}

function streamFileToSocket(socketId, fileName, fileType, fromName, buffer) {
  let bytesSent = 0;
  const CHUNK_SIZE = 512 * 1024;
  const totalSize = buffer.length;

  io.to(socketId).emit("file-start", {
    name: fileName,
    type: fileType,
    from: fromName,
    totalSize: totalSize
  });

  let offset = 0;

  const sendNextChunk = () => {
    if (offset >= totalSize) {
      io.to(socketId).emit("file-complete", {
        name: fileName,
        from: fromName
      });
      console.log(`Transfer complete: ${fileName} (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
      return;
    }

    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
    bytesSent += chunk.length;
    offset += CHUNK_SIZE;

    io.to(socketId).emit("file-chunk", {
      name: fileName,
      type: fileType,
      from: fromName,
      chunk: Array.from(chunk),
      receivedBytes: bytesSent,
      totalSize: totalSize
    });

    setImmediate(sendNextChunk);
  };

  sendNextChunk();
}

// 🔒 SECURITY: Apply upload rate limiter
app.post("/upload", uploadLimiter, upload.array("file"), (req, res) => {
  const files = req.files;
  const toClientId = req.body.toClientId || null;
  const toSocketIdFallback = req.body.toSocketId || null;
  const fromName = req.body.fromName || "Unknown";
  const approved = req.body.approved === "true"; // NEW: Check if approved

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // 🔒 SECURITY: Validate total size
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const MAX_SIZE = 10 * 1024 * 1024 * 1024;
  if (totalSize > MAX_SIZE) {
    console.log('⚠️ Upload rejected: Size exceeds limit');
    return res.status(400).json({
      error: "Total size exceeds 10GB limit",
      size: totalSize,
      limit: MAX_SIZE
    });
  }

  let targetSocketId = null;
  let targetClientId = null;

  if (toClientId) {
    targetClientId = toClientId;
    targetSocketId = clientIdToSocketId(toClientId);
  } else if (toSocketIdFallback) {
    targetSocketId = toSocketIdFallback;
    const info = devices.get(toSocketIdFallback);
    targetClientId = info?.clientId || null;
  } else {
    return res.status(400).json({ error: "Receiver not selected" });
  }

  const results = [];

  // NEW: Only send if approved
  if (targetSocketId && approved) {
    console.log(`📤 Sending ${files.length} file(s) from ${fromName} to ${targetClientId}`);

    files.forEach((file) => {
      streamFileToSocket(targetSocketId, file.originalname, file.mimetype, fromName, file.buffer);
      results.push({ name: file.originalname, status: "sent", size: file.size });
    });

    return res.json({
      message: "ok",
      toClientId: targetClientId,
      delivered: results
    });
  } else if (!approved) {
    // NEW: Return success for approval request
    return res.json({
      message: "approval_requested",
      toClientId: targetClientId
    });
  } else {
    if (!targetClientId) {
      return res.status(400).json({ error: "Target not available currently" });
    }

    // 🔒 SECURITY: Limit queue size per client
    const queue = pendingQueue.get(targetClientId) || [];
    if (queue.length >= 50) {
      return res.status(400).json({ error: "Queue full, recipient must come online" });
    }

    console.log(`📥 Queueing ${files.length} file(s) for offline device ${targetClientId}`);

    files.forEach((file) => {
      queue.push({
        fileName: file.originalname,
        fileType: file.mimetype,
        fileBufferBase64: file.buffer.toString('base64'),
        from: fromName,
        queuedAt: Date.now()
      });
      results.push({ name: file.originalname, status: "queued", size: file.size });
    });
    pendingQueue.set(targetClientId, queue);

    return res.json({
      message: "ok",
      toClientId: targetClientId,
      delivered: results
    });
  }
});

// 🔒 SECURITY: Clean old queued files (every hour)
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  for (const [clientId, queue] of pendingQueue.entries()) {
    const filtered = queue.filter(item => now - item.queuedAt < ONE_HOUR);
    if (filtered.length === 0) {
      pendingQueue.delete(clientId);
    } else {
      pendingQueue.set(clientId, filtered);
    }
  }
}, 60 * 60 * 1000);

app.get("/health", (_, res) => res.json({
  ok: true,
  timestamp: new Date().toISOString(),
  connectedDevices: devices.size
}));

/* ========================================
   AUTO-CLEANUP EXPIRED CHAT MESSAGES (3 HOURS)
   ======================================== */
setInterval(() => {
  const now = Date.now();
  const EXPIRY_MS = 3 * 60 * 60 * 1000; // 3 hours

  // Clean expired messages from all rooms
  for (const [roomId, room] of chatRooms.entries()) {
    const before = room.messages.length;

    // Remove expired messages
    room.messages = room.messages.filter(msg => msg.expiresAt > now);

    // Remove empty rooms older than 3 hours
    if (room.messages.length === 0 && (now - room.createdAt) > EXPIRY_MS) {
      chatRooms.delete(roomId);
      console.log(`🗑️  Deleted expired chat room: ${roomId}`);
    } else if (room.messages.length < before) {
      console.log(`🧹 Cleaned ${before - room.messages.length} expired messages from ${roomId}`);
    }
  }
}, 60 * 1000); // Run every minute

// Get all local IP addresses (Fix for changing IPs)
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces

server.listen(PORT, HOST, () => {
  console.log('   OyeSwap Server Beast mode ON');

  const localIPs = getLocalIPs();

  if (localIPs.length > 0) {
    console.log('📱 Access from ANY device on same WiFi:\n');
    localIPs.forEach(ip => {
      console.log(`   http://${ip}:${PORT}`);
    });
  }

  console.log('\n💻 Access from this computer:\n');
  console.log(`   http://localhost:${PORT}`);

  if (localIPs.length > 0) {
    console.log('\n📋 Quick Access Instructions:\n');
    console.log(`   • On Mobile: Open browser → http://${localIPs[0]}:${PORT}`);
    console.log(`   • On PC: Open browser → http://localhost:${PORT}`);
    console.log(`   • On Tablet: Open browser → http://${localIPs[0]}:${PORT}`);
    console.log('\n💡 Tip: Bookmark the URL on your devices for easy access!');
  }

  console.log('\n🔒 Security Features Active:');
  console.log('\n========================================\n');
});
