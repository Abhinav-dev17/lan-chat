const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const os = require("os");

const db = require("./db");
const { makeToken, verify } = require("./auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

// ---------- Auth middleware for REST routes ----------
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: "Not logged in" });
  req.username = payload.username;
  next();
}

// ---------- Auth routes ----------
app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 characters, letters/numbers/underscore only" });
  }
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  if (db.getUser(username)) return res.status(409).json({ error: "Username already taken" });

  const hash = bcrypt.hashSync(password, 10);
  const user = db.createUser(username, hash);
  const token = makeToken(user.username);
  res.json({ token, username: user.username });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.getUser(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = makeToken(user.username);
  res.json({ token, username: user.username });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ username: req.username });
});

// ---------- Users / DMs ----------
app.get("/api/users", requireAuth, (req, res) => {
  res.json(db.listUsernames().filter((u) => u !== req.username));
});

app.get("/api/conversations", requireAuth, (req, res) => {
  res.json(db.listConversations(req.username));
});

app.get("/api/dm/:otherUser", requireAuth, (req, res) => {
  const other = req.params.otherUser.toLowerCase();
  if (!db.getUser(other)) return res.status(404).json({ error: "User not found" });
  res.json(db.getDM(req.username, other));
});

// ---------- Public room ----------
app.get("/api/public-messages", requireAuth, (req, res) => {
  res.json(db.getPublicMessages());
});

// ---------- Group rooms ----------
app.get("/api/rooms", requireAuth, (req, res) => {
  res.json(db.listRoomsFor(req.username));
});

app.post("/api/rooms", requireAuth, (req, res) => {
  const { name, members } = req.body || {};
  if (!name || !Array.isArray(members)) return res.status(400).json({ error: "Room name and members required" });

  const validMembers = members.map((m) => m.toLowerCase()).filter((m) => db.getUser(m));
  const allMembers = Array.from(new Set([req.username, ...validMembers]));

  const room = db.createRoom(name, allMembers, req.username);

  // Bring any currently-connected members into this room's live channel
  io.in(allMembers.map((m) => `user:${m}`)).socketsJoin(`room:${room.id}`);
  allMembers.forEach((m) => {
    io.to(`user:${m}`).emit("roomCreated", room);
  });

  res.json(room);
});

app.get("/api/rooms/:id/messages", requireAuth, (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room || !room.members.includes(req.username)) return res.status(403).json({ error: "Not a member" });
  res.json(db.getRoomMessages(room.id));
});

// ---------- Socket.io ----------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const payload = verify(token);
  if (!payload) return next(new Error("unauthorized"));
  socket.username = payload.username;
  next();
});

io.on("connection", (socket) => {
  const username = socket.username;
  socket.join(`user:${username}`);
  socket.join("public");
  db.listRoomsFor(username).forEach((r) => socket.join(`room:${r.id}`));

  socket.on("publicMessage", (text) => {
    if (!text || !text.trim()) return;
    const msg = { username, text: text.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    db.addPublicMessage(msg);
    io.to("public").emit("publicMessage", msg);
  });

  socket.on("dmMessage", ({ to, text }) => {
    if (!to || !text || !text.trim()) return;
    const other = to.toLowerCase();
    if (!db.getUser(other)) return;
    const msg = { from: username, to: other, text: text.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    db.addDM(username, other, msg);
    io.to(`user:${username}`).emit("dmMessage", msg);
    io.to(`user:${other}`).emit("dmMessage", msg);
  });

  socket.on("roomMessage", ({ roomId, text }) => {
    const room = db.getRoom(roomId);
    if (!room || !room.members.includes(username) || !text || !text.trim()) return;
    const msg = { roomId, from: username, text: text.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    db.addRoomMessage(roomId, msg);
    io.to(`room:${roomId}`).emit("roomMessage", msg);
  });
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

server.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  console.log("\n=== Same Wave is running ===");
  console.log(`On this PC:       http://localhost:${PORT}`);
  console.log(`On other devices: http://${ip}:${PORT}`);
  console.log("");
});
