let token = localStorage.getItem("sw_token") || "";
const loginBox = document.getElementById("loginBox");
const adminApp = document.getElementById("adminApp");
const loginError = document.getElementById("loginError");

document.getElementById("loginGo").addEventListener("click", async () => {
  const username = document.getElementById("u").value.trim();
  const password = document.getElementById("p").value;
  try {
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) { loginError.textContent = data.error || "Login failed"; return; }
    token = data.token;
    localStorage.setItem("sw_token", token);
    boot();
  } catch (e) { loginError.textContent = "Could not reach server."; }
});
[document.getElementById("u"), document.getElementById("p")].forEach((el) => {
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("loginGo").click(); });
});

async function api(path, opts = {}) {
  const res = await fetch(path, Object.assign({ headers: { "Authorization": "Bearer " + token } }, opts));
  if (res.status === 403) { loginError.textContent = "This account is not the admin account."; loginBox.style.display = "block"; adminApp.style.display = "none"; return null; }
  if (res.status === 401) { localStorage.removeItem("sw_token"); location.reload(); return null; }
  return res.json();
}

async function boot() {
  const me = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
  if (me.status !== 200) return;
  const test = await api("/api/admin/users");
  if (!test) return;
  loginBox.style.display = "none";
  adminApp.style.display = "block";
  showUsers();
}

function setActiveTab(id) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.getElementById("tabUsers").addEventListener("click", showUsers);
document.getElementById("tabPublic").addEventListener("click", showPublic);
document.getElementById("tabDms").addEventListener("click", showDms);
document.getElementById("tabRooms").addEventListener("click", showRooms);

function fmt(ts) { return new Date(ts).toLocaleString(); }

function miniAvatarHtml(name) {
  return `<div class="miniAvatar" style="background:${colorFor(name)}">${initials(name)}</div>`;
}

async function showUsers() {
  setActiveTab("tabUsers");
  document.getElementById("detailView").innerHTML = "";
  const users = await api("/api/admin/users");
  const rows = (users || []).map((u) => `
    <tr>
      <td><div class="userCell">${miniAvatarHtml(u.username)}<span>${escapeHtml(u.username)}</span></div></td>
      <td>${fmt(u.createdAt)}</td>
      <td><button class="deleteBtn" data-username="${u.username}">Delete</button></td>
    </tr>`).join("");
  document.getElementById("listView").innerHTML = `
    <table><thead><tr><th>User</th><th>Joined</th><th></th></tr></thead><tbody>${rows || ""}</tbody></table>
    ${!users || !users.length ? '<div class="empty">No users yet.</div>' : ""}`;

  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.username;
      if (btn.dataset.confirming) {
        const result = await api(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
        if (result && result.success) showUsers();
        else if (result && result.error) alert(result.error);
      } else {
        btn.dataset.confirming = "1";
        btn.textContent = "Confirm delete?";
        btn.classList.add("confirmState");
        setTimeout(() => {
          if (btn.dataset.confirming) {
            btn.dataset.confirming = "";
            btn.textContent = "Delete";
            btn.classList.remove("confirmState");
          }
        }, 4000);
      }
    });
  });
}

async function showPublic() {
  setActiveTab("tabPublic");
  document.getElementById("listView").innerHTML = "";
  const msgs = await api("/api/admin/public-messages");
  renderMessageLog("Public Room — full log", msgs || [], (m) => m.username);
}

async function showDms() {
  setActiveTab("tabDms");
  document.getElementById("detailView").innerHTML = "";
  const pairs = await api("/api/admin/dms");
  const rows = (pairs || []).map((p) => `
    <tr class="clickable" data-a="${p.a}" data-b="${p.b}">
      <td><div class="userCell">${miniAvatarHtml(p.a)}<span>${p.a}</span>&nbsp;↔&nbsp;${miniAvatarHtml(p.b)}<span>${p.b}</span></div></td>
      <td>${p.count} messages</td>
      <td>${p.lastAt || "-"}</td>
    </tr>`).join("");
  document.getElementById("listView").innerHTML = `
    <table><thead><tr><th>Conversation</th><th>Messages</th><th>Last Activity</th></tr></thead><tbody>${rows}</tbody></table>
    ${!pairs || !pairs.length ? '<div class="empty">No DM conversations yet.</div>' : ""}`;
  document.querySelectorAll("#listView tr.clickable").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const a = tr.dataset.a, b = tr.dataset.b;
      const msgs = await api(`/api/admin/dm/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
      renderMessageLog(`DM: ${a} ↔ ${b}`, msgs || [], (m) => m.from, true);
    });
  });
}

async function showRooms() {
  setActiveTab("tabRooms");
  document.getElementById("detailView").innerHTML = "";
  const rooms = await api("/api/admin/rooms");
  const rows = (rooms || []).map((r) => `
    <tr class="clickable" data-id="${r.id}" data-name="${r.name}">
      <td><div class="userCell">${miniAvatarHtml(r.name)}<span>${escapeHtml(r.name)}</span></div></td>
      <td>${r.members.join(", ")}</td>
      <td>${r.createdBy}</td>
    </tr>`).join("");
  document.getElementById("listView").innerHTML = `
    <table><thead><tr><th>Room</th><th>Members</th><th>Created By</th></tr></thead><tbody>${rows}</tbody></table>
    ${!rooms || !rooms.length ? '<div class="empty">No group rooms yet.</div>' : ""}`;
  document.querySelectorAll("#listView tr.clickable").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const id = tr.dataset.id, name = tr.dataset.name;
      const msgs = await api(`/api/admin/rooms/${id}/messages`);
      renderMessageLog(`Room: ${name}`, msgs || [], (m) => m.from, true);
    });
  });
}

function renderMessageLog(title, msgs, whoFn, showBack) {
  const html = [];
  if (showBack) html.push(`<button class="backBtn" id="backBtn">← Back</button>`);
  html.push(`<h3>${title}</h3>`);
  if (!msgs.length) {
    html.push(`<div class="empty">No messages yet.</div>`);
  } else {
    html.push(`<div class="msgLog">`);
    msgs.forEach((m) => {
      html.push(`<div class="msgRow"><span class="time">${m.time}</span><span class="who">${whoFn(m)}</span>${escapeHtml(m.text)}</div>`);
    });
    html.push(`</div>`);
  }
  if (showBack) {
    document.getElementById("listView").style.display = "none";
    document.getElementById("detailView").innerHTML = html.join("");
    document.getElementById("backBtn").addEventListener("click", () => {
      document.getElementById("listView").style.display = "block";
      document.getElementById("detailView").innerHTML = "";
    });
  } else {
    document.getElementById("detailView").innerHTML = html.join("");
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

if (token) boot();
