import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import multer from "multer";
import mime from "mime-types";
import http from "http";
import { Server as SocketServer } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // keep original name; prepend timestamp for uniqueness
    const safe = file.originalname.replace(/[^\w.\-()\[\] ]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

// In-memory devices (socket.id -> {name})
const devices = new Map();

io.on("connection", (socket) => {
  // client sends { name: "Sanket's Phone" }
  socket.on("register", (payload) => {
    const name = (payload?.name || "Unknown").slice(0, 40);
    devices.set(socket.id, { name });
    io.emit("devices", getDeviceList());
  });

  // “send to device” notification (informational)
  socket.on("send-intent", ({ toSocketId, fileName }) => {
    if (io.sockets.sockets.get(toSocketId)) {
      io.to(toSocketId).emit("incoming-file", {
        from: devices.get(socket.id)?.name || "Unknown",
        fileName
      });
    }
  });

  socket.on("disconnect", () => {
    devices.delete(socket.id);
    io.emit("devices", getDeviceList());
  });
});

function getDeviceList() {
  return [...devices.entries()].map(([id, v]) => ({ socketId: id, name: v.name }));
}

// Routes
app.get("/health", (_, res) => res.json({ ok: true }));

// Upload to server (optionally include toSocketId for notify)
app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file" });

  const toSocketId = req.body?.toSocketId;
  if (toSocketId && io.sockets.sockets.get(toSocketId)) {
    io.to(toSocketId).emit("incoming-file", {
      from: req.body?.fromName || "Unknown",
      fileName: file.filename
    });
  }
  res.json({
    message: "Uploaded",
    storedAs: file.filename,
    originalName: file.originalname,
    size: file.size
  });
});

// List files
app.get("/files", (_, res) => {
  const list = fs.readdirSync(uploadsDir).map((f) => {
    const p = path.join(uploadsDir, f);
    const stat = fs.statSync(p);
    return {
      name: f,
      size: stat.size,
      createdAt: stat.ctime
    };
  }).sort((a,b)=> b.createdAt - a.createdAt);
  res.json(list);
});

// Download a file by name
app.get("/download/:name", (req, res) => {
  const filePath = path.join(uploadsDir, path.basename(req.params.name));
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  const mt = mime.lookup(filePath) || "application/octet-stream";
  res.setHeader("Content-Type", mt);
  res.download(filePath);
});

// Optional: delete file
app.delete("/files/:name", (req, res) => {
  const filePath = path.join(uploadsDir, path.basename(req.params.name));
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  fs.unlinkSync(filePath);
  res.json({ message: "Deleted" });
});

// Serve app
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
