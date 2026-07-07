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

// Wraps async route handlers so thrown errors become a clean 500 instead of
// crashing the process or hanging the request.
function ah(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  });
}

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
app.post("/api/register", ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 characters, letters/numbers/underscore only" });
  }
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  if (await db.getUser(username)) return res.status(409).json({ error: "Username already taken" });

  const hash = bcrypt.hashSync(password, 10);
  const user = await db.createUser(username, hash);
  const token = makeToken(user.username);
  res.json({ token, username: user.username });
}));

app.post("/api/login", ah(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.getUser(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = makeToken(user.username);
  res.json({ token, username: user.username });
}));

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ username: req.username });
});

// ---------- Users / DMs ----------
app.get("/api/users", requireAuth, ah(async (req, res) => {
  const usernames = await db.listUsernames();
  res.json(usernames.filter((u) => u !== req.username));
}));

app.get("/api/conversations", requireAuth, ah(async (req, res) => {
  res.json(await db.listConversations(req.username));
}));

app.get("/api/dm/:otherUser", requireAuth, ah(async (req, res) => {
  const other = req.params.otherUser.toLowerCase();
  if (!(await db.getUser(other))) return res.status(404).json({ error: "User not found" });
  res.json(await db.getDM(req.username, other));
}));

// ---------- Public room ----------
app.get("/api/public-messages", requireAuth, ah(async (req, res) => {
  res.json(await db.getPublicMessages());
}));

// ---------- Group rooms ----------
app.get("/api/rooms", requireAuth, ah(async (req, res) => {
  res.json(await db.listRoomsFor(req.username));
}));

app.post("/api/rooms", requireAuth, ah(async (req, res) => {
  const { name, members } = req.body || {};
  if (!name || !Array.isArray(members)) return res.status(400).json({ error: "Room name and members required" });

  const candidates = members.map((m) => m.toLowerCase());
  const existsFlags = await Promise.all(candidates.map((m) => db.getUser(m)));
  const validMembers = candidates.filter((_, i) => existsFlags[i]);
  const allMembers = Array.from(new Set([req.username, ...validMembers]));

  const room = await db.createRoom(name, allMembers, req.username);

  // Bring any currently-connected members into this room's live channel
  io.in(allMembers.map((m) => `user:${m}`)).socketsJoin(`room:${room.id}`);
  allMembers.forEach((m) => {
    io.to(`user:${m}`).emit("roomCreated", room);
  });

  res.json(room);
}));

app.get("/api/rooms/:id/messages", requireAuth, ah(async (req, res) => {
  const room = await db.getRoom(req.params.id);
  if (!room || !room.members.includes(req.username)) return res.status(403).json({ error: "Not a member" });
  res.json(await db.getRoomMessages(room.id));
}));

// ---------- Admin ----------
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "admin").toLowerCase();

function requireAdmin(req, res, next) {
  if (req.username !== ADMIN_USERNAME) return res.status(403).json({ error: "Admin access only" });
  next();
}

app.get("/api/admin/users", requireAuth, requireAdmin, ah(async (req, res) => {
  res.json(await db.listUsersFull());
}));

app.delete("/api/admin/users/:username", requireAuth, requireAdmin, ah(async (req, res) => {
  const target = req.params.username.toLowerCase();
  if (target === ADMIN_USERNAME) return res.status(400).json({ error: "Can't delete the admin account" });
  if (!(await db.getUser(target))) return res.status(404).json({ error: "User not found" });
  await db.deleteUser(target);
  res.json({ success: true });
}));

app.get("/api/admin/public-messages", requireAuth, requireAdmin, ah(async (req, res) => {
  res.json(await db.getPublicMessages(1000));
}));

app.get("/api/admin/dms", requireAuth, requireAdmin, ah(async (req, res) => {
  res.json(await db.listAllDmPairs());
}));

app.get("/api/admin/dm/:userA/:userB", requireAuth, requireAdmin, ah(async (req, res) => {
  res.json(await db.getDM(req.params.userA, req.params.userB, 1000));
}));

app.get("/api/admin/rooms", requireAuth, requireAdmin, ah(async (req, res) => {
  res.json(await db.listAllRooms());
}));

app.get("/api/admin/rooms/:id/messages", requireAuth, requireAdmin, ah(async (req, res) => {
  res.json(await db.getRoomMessages(req.params.id, 1000));
}));

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

  db.listRoomsFor(username)
    .then((myRooms) => myRooms.forEach((r) => socket.join(`room:${r.id}`)))
    .catch((err) => console.error("Failed to join rooms on connect:", err));

  socket.on("publicMessage", async (text) => {
    if (!text || !text.trim()) return;
    const msg = { username, text: text.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    try {
      await db.addPublicMessage(msg);
      io.to("public").emit("publicMessage", msg);
    } catch (err) {
      console.error("publicMessage failed:", err);
    }
  });

  socket.on("dmMessage", async ({ to, text }) => {
    if (!to || !text || !text.trim()) return;
    const other = to.toLowerCase();
    try {
      if (!(await db.getUser(other))) return;
      const msg = { from: username, to: other, text: text.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
      await db.addDM(username, other, msg);
      io.to(`user:${username}`).emit("dmMessage", msg);
      io.to(`user:${other}`).emit("dmMessage", msg);
    } catch (err) {
      console.error("dmMessage failed:", err);
    }
  });

  socket.on("roomMessage", async ({ roomId, text }) => {
    if (!text || !text.trim()) return;
    try {
      const room = await db.getRoom(roomId);
      if (!room || !room.members.includes(username)) return;
      const msg = { roomId, from: username, text: text.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
      await db.addRoomMessage(roomId, msg);
      io.to(`room:${roomId}`).emit("roomMessage", msg);
    } catch (err) {
      console.error("roomMessage failed:", err);
    }
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
