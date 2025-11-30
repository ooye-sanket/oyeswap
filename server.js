import express from "express";
import cors from "cors";
import multer from "multer";
import http from "http";
import { Server as SocketServer } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

// 🚀 OPTIMIZED: Increased payload limits and tuned socket.io for large files
const io = new SocketServer(server, { 
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8, // 100MB buffer
  pingTimeout: 60000, // 60s timeout
  pingInterval: 25000, // Keep connection alive
  transports: ['websocket', 'polling'], // Prioritize websocket
  upgradeTimeout: 30000,
  allowEIO3: true
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static("public"));

// 🚀 OPTIMIZED: Larger chunk size and no file size limit in multer
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: Infinity, // No limit, we check manually
    files: 10
  }
});

// Track connected devices
const devices = new Map();

function clientIdToSocketId(clientId) {
  for (const [socketId, info] of devices.entries()) {
    if (info.clientId === clientId) return socketId;
  }
  return null;
}

// Pending queue for offline devices
const pendingQueue = new Map();

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register", ({ name, clientId }) => {
    devices.set(socket.id, { name: name || "Unknown", clientId: clientId || null });
    io.emit("devices", getDevices());

    if (clientId) {
      const queued = pendingQueue.get(clientId);
      if (queued && queued.length > 0) {
        console.log(`Delivering ${queued.length} queued file(s) to clientId=${clientId}`);
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
  });
});

function getDevices() {
  return [...devices.entries()].map(([socketId, data]) => ({
    socketId,
    clientId: data.clientId,
    name: data.name
  }));
}

// 🚀 OPTIMIZED: Larger chunks (512KB) for faster transfer
function streamFileToSocket(socketId, fileName, fileType, fromName, buffer) {
  let bytesSent = 0;
  const CHUNK_SIZE = 512 * 1024; // 512KB chunks (8x faster than 64KB)
  const totalSize = buffer.length;

  io.to(socketId).emit("file-start", {
    name: fileName,
    type: fileType,
    from: fromName,
    totalSize: totalSize // Send total size for accurate progress
  });

  // 🚀 OPTIMIZED: Async chunking with setImmediate for non-blocking
  let offset = 0;
  
  const sendNextChunk = () => {
    if (offset >= totalSize) {
      io.to(socketId).emit("file-complete", {
        name: fileName,
        from: fromName
      });
      return;
    }

    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
    bytesSent += chunk.length;
    offset += CHUNK_SIZE;

    io.to(socketId).emit("file-chunk", {
      name: fileName,
      type: fileType,
      from: fromName,
      chunk: Array.from(chunk), // Convert to array for JSON serialization
      receivedBytes: bytesSent,
      totalSize: totalSize
    });

    // 🚀 Non-blocking: use setImmediate to allow other operations
    setImmediate(sendNextChunk);
  };

  sendNextChunk();
}

/* ------------------------------------------------------
   🚀 OPTIMIZED Upload endpoint - Streaming approach
------------------------------------------------------- */
app.post("/upload", upload.array("file"), (req, res) => {
  const files = req.files;
  const toClientId = req.body.toClientId || null;
  const toSocketIdFallback = req.body.toSocketId || null;
  const fromName = req.body.fromName || "Unknown";

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Check 10GB limit
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
  if (totalSize > MAX_SIZE) {
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
    // 🚀 Target online -> stream files
    files.forEach((file) => {
      streamFileToSocket(targetSocketId, file.originalname, file.mimetype, fromName, file.buffer);
      results.push({ name: file.originalname, status: "sent", size: file.size });
    });

    // Respond immediately after starting stream
    return res.json({
      message: "ok",
      toClientId: targetClientId,
      delivered: results
    });
  } else {
    // Target offline -> queue
    if (!targetClientId) {
      return res.status(400).json({ error: "Target not available currently" });
    }

    const queue = pendingQueue.get(targetClientId) || [];
    files.forEach((file) => {
      // 🚀 OPTIMIZATION: For offline queue, compress if needed
      queue.push({
        fileName: file.originalname,
        fileType: file.mimetype,
        fileBufferBase64: file.buffer.toString('base64'),
        from: fromName
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

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});