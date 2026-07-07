// Talks to the actual server. Only used in the real app (index.html) —
// preview.html never loads this file, so it can't accidentally hit the
// backend or need a login.

async function apiCall(token, path, opts = {}) {
  opts.headers = Object.assign(
    { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    opts.headers || {}
  );
  const res = await fetch(path, opts);
  if (res.status === 401) {
    localStorage.removeItem("sw_token");
    location.reload();
    return null;
  }
  return res.json();
}

function connectSocket(token, handlers) {
  const socket = io({ auth: { token } });
  socket.on("publicMessage", handlers.onPublicMessage);
  socket.on("dmMessage", handlers.onDmMessage);
  socket.on("roomMessage", handlers.onRoomMessage);
  socket.on("roomCreated", handlers.onRoomCreated);
  return socket;
}
