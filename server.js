require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const JWT_SECRET = process.env.JWT_SECRET || "nexus-secret-ganti-di-produksi";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "nexus.db");
const db = new Database(DB_PATH);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL === "*" ? "*" : [FRONTEND_URL, "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============ DATABASE ============
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  password TEXT,
  max_users INTEGER,
  admin TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  username TEXT,
  text TEXT,
  type TEXT,
  data TEXT,
  time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_msg_room ON messages(room_id, time);
`);

// ============ MIDDLEWARE ============
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "3mb" }));
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: "Terlalu banyak request.",
});
app.use("/api/", limiter);

// ============ HELPERS ============
const clean = (v, n = 80) =>
  String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n);
const cleanRoom = (v) =>
  clean(v, 40).replace(/[^a-zA-Z0-9_-]/g, "-").toUpperCase();
const hashPass = (p) => crypto.createHash("sha256").update(p).digest("hex");
const genId = () => Date.now() + "-" + Math.random().toString(36).slice(2, 8);

const rooms = new Map();
const room = (id) => {
  if (!rooms.has(id)) {
    const dbRoom = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id);
    rooms.set(id, {
      messages: [],
      users: new Map(),
      password: dbRoom?.password || null,
      maxUsers: dbRoom?.max_users || 50,
      admin: dbRoom?.admin || null,
      banned: new Set(),
      createdAt: dbRoom?.created_at || Date.now(),
    });
  }
  return rooms.get(id);
};
const usersList = (r) => [...r.users.values()];

// ============ AUTH API ============
app.post("/api/register", async (req, res) => {
  try {
    const username = clean(req.body.username, 24);
    const password = String(req.body.password || "");
    if (!username || password.length < 4)
      return res.status(400).json({ error: "Username / password tidak valid." });
    const hash = await bcrypt.hash(password, 10);
    db.prepare(
      "INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)"
    ).run(username, hash, Date.now());
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "Username sudah dipakai." });
  }
});

app.post("/api/login", async (req, res) => {
  const username = clean(req.body.username, 24);
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: "Login gagal." });
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, {
    expiresIn: "7d",
  });
  res.json({ token, username });
});

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token invalid" });
  }
};

app.get("/api/me", auth, (req, res) => res.json(req.user));
app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

// ============ SOCKET.IO ============
io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  socket.on("create-room", ({ roomId, username, password, maxUsers }) => {
    roomId = cleanRoom(roomId);
    username = clean(username, 24);
    if (!roomId || !username)
      return socket.emit("join-error", "Data tidak lengkap.");
    const r = room(roomId);
    if (r.users.size > 0)
      return socket.emit("join-error", "Room sudah ada.");
    r.password = password ? hashPass(password) : null;
    r.maxUsers = Math.min(Math.max(parseInt(maxUsers) || 50, 2), 200);
    r.admin = socket.id;
    db.prepare(
      "INSERT OR REPLACE INTO rooms (id, password, max_users, admin, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(roomId, r.password, r.maxUsers, r.admin, r.createdAt);
    joinRoom(socket, r, roomId, username);
  });

  socket.on("join-room", ({ roomId, username, password }) => {
    roomId = cleanRoom(roomId);
    username = clean(username, 24);
    if (!roomId || !username)
      return socket.emit("join-error", "Data tidak lengkap.");
    const r = room(roomId);
    if (r.banned.has(username))
      return socket.emit("join-error", "Kamu di-ban dari room ini.");
    if (r.password && r.password !== hashPass(password || ""))
      return socket.emit("join-error", "Password salah.");
    if (r.users.size >= r.maxUsers)
      return socket.emit("join-error", "Room penuh.");
    joinRoom(socket, r, roomId, username);
  });

  socket.on("send-message", (payload) => {
    const { roomId, username } = socket.data || {};
    if (!roomId || !username) return;
    const r = rooms.get(roomId);
    const u = r?.users.get(socket.id);
    if (!r || !u) return;
    const text = clean(payload?.text, 2000);
    if (!text) return;
    const m = {
      id: genId(),
      username,
      userId: socket.id,
      color: u.color,
      text,
      time: Date.now(),
      replyTo: payload?.replyTo || null,
      type: "text",
    };
    r.messages.push(m);
    if (r.messages.length > 500) r.messages.shift();
    db.prepare(
      "INSERT INTO messages (id, room_id, username, text, type, data, time) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(m.id, roomId, m.username, m.text, m.type, null, m.time);
    io.to(roomId).emit("new-message", m);
  });

  socket.on("edit-message", ({ id, text }) => {
    const { roomId, username } = socket.data || {};
    const r = rooms.get(roomId);
    if (!r) return;
    const m = r.messages.find((x) => x.id === id && x.username === username);
    if (!m) return;
    m.text = clean(text, 2000);
    m.edited = Date.now();
    db.prepare("UPDATE messages SET text = ? WHERE id = ?").run(m.text, id);
    io.to(roomId).emit("message-edited", m);
  });

  socket.on("delete-message", (id) => {
    const { roomId, username } = socket.data || {};
    const r = rooms.get(roomId);
    if (!r) return;
    const idx = r.messages.findIndex(
      (x) => x.id === id && x.username === username
    );
    if (idx === -1) return;
    r.messages.splice(idx, 1);
    db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    io.to(roomId).emit("message-deleted", id);
  });

  socket.on("react-message", ({ id, emoji }) => {
    const { roomId, username } = socket.data || {};
    const r = rooms.get(roomId);
    if (!r) return;
    const m = r.messages.find((x) => x.id === id);
    if (!m) return;
    m.reactions = m.reactions || {};
    m.reactions[emoji] = m.reactions[emoji] || [];
    const i = m.reactions[emoji].indexOf(username);
    if (i === -1) m.reactions[emoji].push(username);
    else m.reactions[emoji].splice(i, 1);
    if (!m.reactions[emoji].length) delete m.reactions[emoji];
    io.to(roomId).emit("message-reacted", { id, reactions: m.reactions });
  });

  socket.on("send-file", ({ name, type, data, size }) => {
    const { roomId, username } = socket.data || {};
    const r = rooms.get(roomId);
    if (!r) return;
    if (size > 2 * 1024 * 1024)
      return socket.emit("join-error", "File max 2MB.");
    const u = r.users.get(socket.id);
    const m = {
      id: genId(),
      username,
      userId: socket.id,
      color: u?.color || "#7c5cff",
      type: type.startsWith("image/") ? "image" : "file",
      name,
      mime: type,
      data,
      time: Date.now(),
    };
    r.messages.push(m);
    db.prepare(
      "INSERT INTO messages (id, room_id, username, text, type, data, time) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(m.id, roomId, m.username, null, m.type, data, m.time);
    io.to(roomId).emit("new-message", m);
  });

  socket.on("typing", (isTyping) => {
    if (socket.data?.roomId)
      socket.to(socket.data.roomId).emit("user-typing", {
        username: socket.data.username,
        isTyping: !!isTyping,
      });
  });

  socket.on("webrtc-offer", ({ targetId, offer }) =>
    io.to(targetId).emit("webrtc-offer", { fromId: socket.id, offer })
  );
  socket.on("webrtc-answer", ({ targetId, answer }) =>
    io.to(targetId).emit("webrtc-answer", { fromId: socket.id, answer })
  );
  socket.on("webrtc-ice", ({ targetId, candidate }) =>
    io.to(targetId).emit("webrtc-ice", { fromId: socket.id, candidate })
  );

  socket.on("kick-user", (targetId) => {
    const { roomId } = socket.data || {};
    const r = rooms.get(roomId);
    if (!r || r.admin !== socket.id) return;
    const target = r.users.get(targetId);
    if (!target) return;
    r.banned.add(target.username);
    io.to(targetId).emit("kicked", "Kamu di-kick oleh admin.");
    io.sockets.sockets.get(targetId)?.disconnect();
    io.to(roomId).emit("system-message", {
      text: `${target.username} di-kick oleh admin.`,
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    const { roomId, username } = socket.data || {};
    const r = rooms.get(roomId);
    if (!r) return;
    r.users.delete(socket.id);
    socket
      .to(roomId)
      .emit("system-message", { text: `${username} meninggalkan room.` });
    io.to(roomId).emit("room-users", usersList(r));
  });
});

function joinRoom(socket, r, roomId, username) {
  const color = [
    "#7c5cff", "#16c7b7", "#ff7a59", "#4d9fff", "#d85cff", "#ff5c8a",
  ][Math.floor(Math.random() * 6)];
  r.users.set(socket.id, {
    id: socket.id,
    username,
    color,
    joinedAt: Date.now(),
  });
  socket.join(roomId);
  socket.data = { roomId, username };

  const history = db
    .prepare(
      "SELECT id, username, text, type, data, time FROM messages WHERE room_id = ? ORDER BY time DESC LIMIT 100"
    )
    .all(roomId)
    .reverse()
    .map((m) => ({
      id: m.id,
      username: m.username,
      userId: null,
      color: "#7c5cff",
      text: m.text,
      type: m.type,
      data: m.data,
      time: m.time,
    }));

  socket.emit("room-joined", {
    roomId,
    username,
    messages: history,
    users: usersList(r),
    isAdmin: r.admin === socket.id,
    roomInfo: {
      hasPassword: !!r.password,
      maxUsers: r.maxUsers,
      createdAt: r.createdAt,
    },
  });
  socket
    .to(roomId)
    .emit("system-message", { text: `${username} bergabung ke room.` });
  io.to(roomId).emit("room-users", usersList(r));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 NEXUS backend running on port ${PORT}`)
);
