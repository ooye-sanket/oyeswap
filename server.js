import express from "express";
import cors from "cors";
import multer from "multer";
import http from "http";
import { Server as SocketServer } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.static("public"));

// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Track connected devices
// devices: socketId -> { name, clientId }
const devices = new Map();

// Map clientId -> socketId (only for currently connected sockets)
function clientIdToSocketId(clientId) {
  for (const [socketId, info] of devices.entries()) {
    if (info.clientId === clientId) return socketId;
  }
  return null;
}

// Pending queue for offline devices (keyed by clientId)
// pendingQueue: clientId -> [ { fileName, fileType, fileBufferBase64, from } ]
const pendingQueue = new Map();

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register", ({ name, clientId }) => {
    // Save device info
    devices.set(socket.id, { name: name || "Unknown", clientId: clientId || null });
    io.emit("devices", getDevices());

    // If there are queued files for this clientId, deliver now
    if (clientId) {
      const queued = pendingQueue.get(clientId);
      if (queued && queued.length > 0) {
        console.log(`Delivering ${queued.length} queued file(s) to clientId=${clientId} (socket=${socket.id})`);
        queued.forEach((item) => {
          io.to(socket.id).emit("file-transfer", {
            fileName: item.fileName,
            fileType: item.fileType,
            fileData: item.fileBufferBase64,
            from: item.from
          });
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

// Helper: list of devices shown to clients
// We'll include clientId for stable mapping
function getDevices() {
  return [...devices.entries()].map(([socketId, data]) => ({
    socketId,
    clientId: data.clientId,
    name: data.name
  }));
}

/* ------------------------------------------------------
   Upload endpoint
   Accepts multiple files (upload.array("file"))
   Expects req.body.toClientId (preferred) or toSocketId (legacy)
------------------------------------------------------- */
app.post("/upload", upload.array("file"), (req, res) => {
  const files = req.files;
  const toClientId = req.body.toClientId || null;
  const toSocketIdFallback = req.body.toSocketId || null;
  const fromName = req.body.fromName || "Unknown";

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Determine target: prefer clientId
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

  // Prepare per-file results
  const results = [];

  if (targetSocketId) {
    // Target currently connected -> deliver immediately
    files.forEach((file) => {
      io.to(targetSocketId).emit("file-transfer", {
        fileName: file.originalname,
        fileType: file.mimetype,
        fileData: file.buffer.toString("base64"),
        from: fromName
      });
      results.push({ name: file.originalname, status: "sent" });
    });
  } else {
    // Target offline -> queue under clientId (needs to exist)
    if (!targetClientId) {
      return res.status(400).json({ error: "Target not available currently" });
    }
   
    


    const queue = pendingQueue.get(targetClientId) || [];
    files.forEach((file) => {
      queue.push({
        fileName: file.originalname,

        fileType: file.mimetype,

        fileBufferBase64: file.buffer.toString("base64"),

        from: fromName

      });
      results.push({ name: file.originalname, status: "queued" });
    });
    pendingQueue.set(targetClientId, queue);
  }

  return res.json({
    message: "ok",
    toClientId: targetClientId,
    delivered: results
  });
});

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://0.0.0.0:${PORT}`));