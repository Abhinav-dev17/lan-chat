const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Serve the chat page and its assets
app.use(express.static("public"));

// Keep track of connected users
const users = new Map(); // socket.id -> username

io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // When a user sets their name
  socket.on("join", (username) => {
    users.set(socket.id, username);
    io.emit("system", `${username} joined the chat`);
    io.emit("userList", Array.from(users.values()));
  });

  // When a user sends a message
  socket.on("chatMessage", (text) => {
    const username = users.get(socket.id) || "Anonymous";
    io.emit("chatMessage", {
      username,
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });
  });

  // Typing indicator (optional nice touch)
  socket.on("typing", () => {
    const username = users.get(socket.id) || "Someone";
    socket.broadcast.emit("typing", username);
  });

  socket.on("disconnect", () => {
    const username = users.get(socket.id);
    if (username) {
      users.delete(socket.id);
      io.emit("system", `${username} left the chat`);
      io.emit("userList", Array.from(users.values()));
    }
  });
});

// Helper: find this machine's LAN IP address to show in the console
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

server.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  console.log("\n=== LAN Chat is running ===");
  console.log(`On this PC:      http://localhost:${PORT}`);
  console.log(`On other devices: http://${ip}:${PORT}`);
  console.log("(Make sure everyone is connected to the same WiFi)\n");
});
