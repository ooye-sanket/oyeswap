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

io.on("connection", (socket) => {
  // 🔒 SECURITY: Check connection rate
  if (!checkConnectionLimit(socket.id)) {
    console.log('⚠️ Connection rejected: Too many attempts from', socket.id);
    socket.disconnect();
    return;
  }

  console.log("✅ Connected:", socket.id);

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
    console.log("❌ Disconnected:", socket.id);
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
  const CHUNK_SIZE = 512 * 1024; // 512KB chunks for speed
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
      console.log(`✅ Transfer complete: ${fileName} (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
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

  if (targetSocketId) {
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

// 🔥 Get all local IP addresses (Fix for changing IPs)
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
      console.log(`   ✅ http://${ip}:${PORT}`);
    });
  }
  
  console.log('\n💻 Access from this computer:\n');
  console.log(`   ✅ http://localhost:${PORT}`);
  
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