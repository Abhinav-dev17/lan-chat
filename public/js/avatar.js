// Shared avatar helpers — used by both app.js (real app) and preview-app.js (mock demo)

const AVATAR_COLORS = ["#7c5cff","#33a3d6","#e07a5f","#43aa8b","#c65ba0","#d9a441","#5c7cff","#ff6b8b"];

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function setAvatar(el, name) {
  el.style.background = colorFor(name);
  el.textContent = initials(name);
}
