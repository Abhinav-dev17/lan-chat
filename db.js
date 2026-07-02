const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data", "db.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: {},          // username -> { username, passwordHash, createdAt }
      publicMessages: [],
      dms: {},             // "userA|userB" (sorted) -> [ { from, text, time } ]
      rooms: {},            // roomId -> { id, name, members: [usernames], createdBy, createdAt }
      roomMessages: {}      // roomId -> [ { from, text, time } ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

let db = loadDB();

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function dmKey(userA, userB) {
  return [userA, userB].sort().join("|");
}

module.exports = {
  // Users
  getUser(username) {
    return db.users[username.toLowerCase()];
  },
  createUser(username, passwordHash) {
    const key = username.toLowerCase();
    db.users[key] = { username: key, passwordHash, createdAt: Date.now() };
    save();
    return db.users[key];
  },
  listUsernames() {
    return Object.keys(db.users);
  },

  // Public room
  getPublicMessages(limit = 100) {
    return db.publicMessages.slice(-limit);
  },
  addPublicMessage(msg) {
    db.publicMessages.push(msg);
    save();
  },

  // Direct messages
  getDM(userA, userB, limit = 200) {
    const key = dmKey(userA, userB);
    return (db.dms[key] || []).slice(-limit);
  },
  addDM(userA, userB, msg) {
    const key = dmKey(userA, userB);
    if (!db.dms[key]) db.dms[key] = [];
    db.dms[key].push(msg);
    save();
  },
  listConversations(username) {
    // Returns list of usernames this user has an existing DM thread with
    const partners = new Set();
    for (const key of Object.keys(db.dms)) {
      const [a, b] = key.split("|");
      if (a === username) partners.add(b);
      else if (b === username) partners.add(a);
    }
    return Array.from(partners);
  },

  // Group rooms
  createRoom(name, members, createdBy) {
    const id = "room_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    db.rooms[id] = { id, name, members: Array.from(new Set(members)), createdBy, createdAt: Date.now() };
    db.roomMessages[id] = [];
    save();
    return db.rooms[id];
  },
  getRoom(id) {
    return db.rooms[id];
  },
  listRoomsFor(username) {
    return Object.values(db.rooms).filter((r) => r.members.includes(username));
  },
  getRoomMessages(id, limit = 200) {
    return (db.roomMessages[id] || []).slice(-limit);
  },
  addRoomMessage(id, msg) {
    if (!db.roomMessages[id]) db.roomMessages[id] = [];
    db.roomMessages[id].push(msg);
    save();
  }
};
