// Real app bootstrap. Uses api.js (network) + ui-render.js (pure rendering)
// + avatar.js (shared helpers). This file is only loaded by index.html.

let token = localStorage.getItem("sw_token") || "";
let myUsername = localStorage.getItem("sw_username") || "";
let socket = null;

let current = null; // { type: 'public' } | { type:'dm', with } | { type:'room', id, name, members, createdBy }
let dmThreads = new Set(JSON.parse(localStorage.getItem("sw_dms") || "[]"));
let rooms = [];
let activeFilter = "all";
let searchQuery = "";
const previews = JSON.parse(localStorage.getItem("sw_previews") || "{}");

// ---------- DOM refs ----------
const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");
const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const authSubmit = document.getElementById("authSubmit");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");

const chatListEl = document.getElementById("chatList");
const messagesEl = document.getElementById("messages");
const emptyStateEl = document.getElementById("emptyState");
const conversationViewEl = document.getElementById("conversationView");

const headerRefs = {
  avatarEl: document.getElementById("headerAvatar"),
  nameEl: document.getElementById("chatHeaderName"),
  subEl: document.getElementById("chatHeaderSub")
};
const infoRefs = {
  avatarEl: document.getElementById("infoAvatar"),
  nameEl: document.getElementById("infoName"),
  subEl: document.getElementById("infoSub"),
  membersSectionEl: document.getElementById("infoMembersSection"),
  membersListEl: document.getElementById("infoMembersList")
};

// ---------- Auth screen ----------
let authMode = "login";
tabLogin.addEventListener("click", () => { authMode = "login"; tabLogin.classList.add("active"); tabRegister.classList.remove("active"); authSubmit.textContent = "Log in"; authError.textContent = ""; });
tabRegister.addEventListener("click", () => { authMode = "register"; tabRegister.classList.add("active"); tabLogin.classList.remove("active"); authSubmit.textContent = "Register"; authError.textContent = ""; });

authSubmit.addEventListener("click", async () => {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  if (!username || !password) { authError.textContent = "Enter a username and password."; return; }
  try {
    const res = await fetch(`/api/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { authError.textContent = data.error || "Something went wrong."; return; }
    token = data.token;
    myUsername = data.username;
    localStorage.setItem("sw_token", token);
    localStorage.setItem("sw_username", myUsername);
    startApp();
  } catch (e) {
    authError.textContent = "Could not reach the server.";
  }
});
[authUsername, authPassword].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") authSubmit.click(); }));

document.getElementById("railAvatar").addEventListener("click", () => {
  if (!confirm("Log out?")) return;
  localStorage.removeItem("sw_token");
  localStorage.removeItem("sw_username");
  localStorage.removeItem("sw_dms");
  localStorage.removeItem("sw_previews");
  location.reload();
});

// ---------- App startup ----------
async function startApp() {
  const me = await apiCall(token, "/api/me");
  if (!me) return;
  authScreen.style.display = "none";
  appScreen.style.display = "block";
  setAvatar(document.getElementById("railAvatar"), me.username);

  socket = connectSocket(token, {
    onPublicMessage: (m) => {
      updatePreview("public", null, m.username, m.text, m.time);
      if (current && current.type === "public") addMessageBubble(messagesEl, m.username, m.text, m.time, myUsername);
    },
    onDmMessage: (m) => {
      const other = m.from === myUsername ? m.to : m.from;
      dmThreads.add(other);
      localStorage.setItem("sw_dms", JSON.stringify(Array.from(dmThreads)));
      updatePreview("dm", other, m.from, m.text, m.time);
      if (current && current.type === "dm" && current.with === other) addMessageBubble(messagesEl, m.from, m.text, m.time, myUsername);
    },
    onRoomMessage: (m) => {
      updatePreview("room", m.roomId, m.from, m.text, m.time);
      if (current && current.type === "room" && current.id === m.roomId) addMessageBubble(messagesEl, m.from, m.text, m.time, myUsername);
    },
    onRoomCreated: (room) => {
      if (!rooms.find((r) => r.id === room.id)) rooms.push(room);
      rerenderList();
    }
  });

  const convos = await apiCall(token, "/api/conversations");
  (convos || []).forEach((u) => dmThreads.add(u));

  rooms = (await apiCall(token, "/api/rooms")) || [];

  rerenderList();
}

function updatePreview(type, id, who, text, time) {
  previews[itemKey(type, id)] = { who, text, time, ts: Date.now() };
  localStorage.setItem("sw_previews", JSON.stringify(previews));
  rerenderList();
}

// ---------- Filter tabs / search ----------
document.querySelectorAll("#filterTabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#filterTabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    rerenderList();
  });
});
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  rerenderList();
});

function rerenderList() {
  const items = [];
  if (activeFilter === "all" || activeFilter === "public") items.push({ type: "public", id: null, name: "Public Room" });
  if (activeFilter === "all" || activeFilter === "dm") Array.from(dmThreads).forEach((u) => items.push({ type: "dm", id: u, name: u }));
  if (activeFilter === "all" || activeFilter === "room") rooms.forEach((r) => items.push({ type: "room", id: r.id, name: r.name, room: r }));

  const filtered = items.filter((it) => !searchQuery || it.name.toLowerCase().includes(searchQuery));
  filtered.sort((a, b) => {
    const pa = previews[itemKey(a.type, a.id)];
    const pb = previews[itemKey(b.type, b.id)];
    if (a.type === "public" && !pa) return -1;
    if (b.type === "public" && !pb) return 1;
    return (pb ? pb.ts : 0) - (pa ? pa.ts : 0);
  });

  const currentKey = current ? itemKey(current.type, current.type === "dm" ? current.with : current.id) : "";
  renderChatList(chatListEl, filtered, previews, currentKey, myUsername, (it) => {
    if (it.type === "public") openPublic();
    else if (it.type === "dm") openDM(it.id);
    else openRoom(it.room);
    closeListDrawer();
  });
}

// ---------- Opening a conversation ----------
async function openPublic() {
  current = { type: "public" };
  showConversationUI(emptyStateEl, conversationViewEl);
  setHeaderForPublic(headerRefs);
  rerenderList();
  setInfoPublic(infoRefs);
  const msgs = await apiCall(token, "/api/public-messages");
  renderMessages(messagesEl, (msgs || []).map((m) => ({ who: m.username, text: m.text, time: m.time })), myUsername);
}

async function openDM(username) {
  current = { type: "dm", with: username };
  showConversationUI(emptyStateEl, conversationViewEl);
  setHeaderForDM(headerRefs, username);
  rerenderList();
  setInfoDM(infoRefs, username);
  const msgs = await apiCall(token, "/api/dm/" + encodeURIComponent(username));
  renderMessages(messagesEl, (msgs || []).map((m) => ({ who: m.from, text: m.text, time: m.time })), myUsername);
}

async function openRoom(room) {
  current = { type: "room", id: room.id, name: room.name, members: room.members, createdBy: room.createdBy };
  showConversationUI(emptyStateEl, conversationViewEl);
  setHeaderForRoom(headerRefs, room);
  rerenderList();
  setInfoRoom(infoRefs, room);
  const msgs = await apiCall(token, "/api/rooms/" + room.id + "/messages");
  renderMessages(messagesEl, (msgs || []).map((m) => ({ who: m.from, text: m.text, time: m.time })), myUsername);
}

// ---------- Info panel toggle ----------
const infoCol = document.getElementById("infoCol");
document.getElementById("infoToggleBtn").addEventListener("click", () => {
  infoCol.classList.toggle("hidden");
  infoCol.classList.toggle("open");
});
document.getElementById("chatHeader").addEventListener("click", (e) => {
  if (e.target.id === "menuBtn") return;
  infoCol.classList.remove("hidden");
  infoCol.classList.add("open");
});

// ---------- Sending ----------
function sendMessage() {
  if (!current) return;
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  if (current.type === "public") socket.emit("publicMessage", text);
  else if (current.type === "dm") socket.emit("dmMessage", { to: current.with, text });
  else if (current.type === "room") socket.emit("roomMessage", { roomId: current.id, text });
}
document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("msgInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

// ---------- New chat modal ----------
const newModal = document.getElementById("newModal");
document.getElementById("newBtn").addEventListener("click", () => newModal.classList.add("show"));
document.getElementById("optPublic").addEventListener("click", () => { newModal.classList.remove("show"); openPublic(); closeListDrawer(); });
document.getElementById("optDm").addEventListener("click", () => { newModal.classList.remove("show"); document.getElementById("dmModal").classList.add("show"); });
document.getElementById("optRoom").addEventListener("click", () => { newModal.classList.remove("show"); document.getElementById("roomModal").classList.add("show"); });

// ---------- New DM modal ----------
document.getElementById("dmModalGo").addEventListener("click", () => {
  const u = document.getElementById("dmUsernameInput").value.trim().toLowerCase();
  if (!u) return;
  document.getElementById("dmModal").classList.remove("show");
  document.getElementById("dmUsernameInput").value = "";
  dmThreads.add(u);
  localStorage.setItem("sw_dms", JSON.stringify(Array.from(dmThreads)));
  rerenderList();
  openDM(u);
  closeListDrawer();
});

// ---------- New Room modal ----------
document.getElementById("roomModalGo").addEventListener("click", async () => {
  const name = document.getElementById("roomNameInput").value.trim();
  const membersRaw = document.getElementById("roomMembersInput").value.trim();
  if (!name) return;
  const members = membersRaw ? membersRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const room = await apiCall(token, "/api/rooms", { method: "POST", body: JSON.stringify({ name, members }) });
  document.getElementById("roomModal").classList.remove("show");
  document.getElementById("roomNameInput").value = "";
  document.getElementById("roomMembersInput").value = "";
  if (room && !room.error) {
    if (!rooms.find((r) => r.id === room.id)) rooms.push(room);
    rerenderList();
    openRoom(room);
    closeListDrawer();
  }
});

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => document.getElementById(btn.dataset.close).classList.remove("show"));
});

// ---------- Mobile drawer ----------
const listCol = document.getElementById("listCol");
const sidebarOverlay = document.getElementById("sidebarOverlay");
function openListDrawer() { listCol.classList.add("open"); sidebarOverlay.classList.add("show"); }
function closeListDrawer() { listCol.classList.remove("open"); sidebarOverlay.classList.remove("show"); }
document.getElementById("menuBtn").addEventListener("click", openListDrawer);
sidebarOverlay.addEventListener("click", () => { closeListDrawer(); infoCol.classList.remove("open"); infoCol.classList.add("hidden"); });

// ---------- Boot ----------
if (token && myUsername) startApp();
