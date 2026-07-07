// Shared rendering functions — takes plain data + DOM refs, renders UI.
// No fetch/socket calls in here on purpose, so preview-app.js can reuse
// every one of these with fake data and no backend at all.

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function itemKey(type, id) {
  return type + ":" + (id || "public");
}

/**
 * Renders the chat list (sidebar). `items` is an array of
 * { type: 'public'|'dm'|'room', id, name, room? }.
 * `previews` is a map of itemKey -> { who, text, time, ts }.
 * `onSelect(item)` fires when a row is clicked.
 */
function renderChatList(listEl, items, previews, currentKey, myUsername, onSelect) {
  listEl.innerHTML = "";

  if (!items.length) {
    listEl.innerHTML = `<div class="emptyList">Nothing here yet.</div>`;
    return;
  }

  items.forEach((it) => {
    const key = itemKey(it.type, it.id);
    const isActive = key === currentKey;

    const el = document.createElement("div");
    el.className = "listItem" + (isActive ? " active" : "");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (it.type === "public") {
      avatar.style.background = "var(--accent-soft)";
      avatar.textContent = "🌐";
    } else {
      setAvatar(avatar, it.name);
    }

    const preview = previews[key];
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(it.name)}</span>
        <span class="time">${preview ? preview.time : ""}</span>
      </div>
      <div class="preview">${
        preview
          ? escapeHtml((preview.who === myUsername ? "You: " : "") + preview.text)
          : it.type === "room" ? "Group room" : it.type === "public" ? "Say hello 👋" : "No messages yet"
      }</div>
    `;

    el.appendChild(avatar);
    el.appendChild(meta);
    el.addEventListener("click", () => onSelect(it));
    listEl.appendChild(el);
  });
}

function addMessageBubble(messagesEl, who, text, time, myUsername) {
  const wrap = document.createElement("div");
  wrap.className = "msg" + (who === myUsername ? " mine" : "");

  const av = document.createElement("div");
  av.className = "avatar small";
  setAvatar(av, who);

  const content = document.createElement("div");
  content.className = "content";
  const whoEl = document.createElement("div");
  whoEl.className = "who";
  whoEl.textContent = who;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  const stamp = document.createElement("div");
  stamp.className = "stamp";
  stamp.textContent = time;

  content.appendChild(whoEl);
  content.appendChild(bubble);
  content.appendChild(stamp);
  wrap.appendChild(av);
  wrap.appendChild(content);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages(messagesEl, list, myUsername) {
  messagesEl.innerHTML = "";
  list.forEach((m) => addMessageBubble(messagesEl, m.who, m.text, m.time, myUsername));
}

function showConversationUI(emptyStateEl, conversationViewEl) {
  emptyStateEl.style.display = "none";
  conversationViewEl.style.display = "flex";
}

// ---------- Chat header ----------
function setHeaderForPublic(refs) {
  refs.avatarEl.style.background = "var(--accent-soft)";
  refs.avatarEl.textContent = "🌐";
  refs.nameEl.textContent = "Public Room";
  refs.subEl.textContent = "Everyone on Same Wave";
}
function setHeaderForDM(refs, username) {
  setAvatar(refs.avatarEl, username);
  refs.nameEl.textContent = username;
  refs.subEl.textContent = "Direct message";
}
function setHeaderForRoom(refs, room) {
  setAvatar(refs.avatarEl, room.name);
  refs.nameEl.textContent = room.name;
  refs.subEl.textContent = room.members.length + " members";
}

// ---------- Info panel ----------
function setInfoPublic(refs) {
  refs.avatarEl.style.background = "var(--accent-soft)";
  refs.avatarEl.textContent = "🌐";
  refs.nameEl.textContent = "Public Room";
  refs.subEl.textContent = "Open to everyone on Same Wave";
  refs.membersSectionEl.style.display = "none";
}
function setInfoDM(refs, username) {
  setAvatar(refs.avatarEl, username);
  refs.nameEl.textContent = username;
  refs.subEl.textContent = "Direct message";
  refs.membersSectionEl.style.display = "none";
}
function setInfoRoom(refs, room) {
  setAvatar(refs.avatarEl, room.name);
  refs.nameEl.textContent = room.name;
  refs.subEl.textContent = "Created by " + room.createdBy;
  refs.membersSectionEl.style.display = "block";
  refs.membersSectionEl.querySelector("h4").textContent = "Members (" + room.members.length + ")";

  const listEl = refs.membersListEl;
  listEl.innerHTML = "";
  room.members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "memberRow";
    const av = document.createElement("div");
    av.className = "avatar";
    av.style.width = "30px"; av.style.height = "30px"; av.style.fontSize = "0.72rem";
    setAvatar(av, m);
    row.appendChild(av);
    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = m;
    row.appendChild(nameEl);
    if (m === room.createdBy) {
      const tag = document.createElement("div");
      tag.className = "roleTag";
      tag.textContent = "Creator";
      row.appendChild(tag);
    }
    listEl.appendChild(row);
  });
}
