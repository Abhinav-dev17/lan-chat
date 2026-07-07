const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.");
  console.error("Set these before starting the server.");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function dmPair(userA, userB) {
  return [userA, userB].sort();
}

module.exports = {
  // ---------- Users ----------
  async getUser(username) {
    const { data, error } = await supabase.from("users").select("*").eq("username", username.toLowerCase()).maybeSingle();
    if (error) throw error;
    return data ? { username: data.username, passwordHash: data.password_hash, createdAt: new Date(data.created_at).getTime() } : null;
  },

  async createUser(username, passwordHash) {
    const key = username.toLowerCase();
    const { data, error } = await supabase.from("users").insert({ username: key, password_hash: passwordHash }).select().maybeSingle();
    if (error) throw error;
    return { username: data.username, passwordHash: data.password_hash, createdAt: new Date(data.created_at).getTime() };
  },

  async listUsernames() {
    const { data, error } = await supabase.from("users").select("username");
    if (error) throw error;
    return (data || []).map((u) => u.username);
  },

  async listUsersFull() {
    const { data, error } = await supabase.from("users").select("username, created_at").order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((u) => ({ username: u.username, createdAt: new Date(u.created_at).getTime() }));
  },

  async deleteUser(username) {
    const key = username.toLowerCase();

    // Remove them from any group rooms so they don't linger as a ghost member
    const { data: rooms, error: roomsErr } = await supabase.from("rooms").select("id, members").contains("members", [key]);
    if (roomsErr) throw roomsErr;
    for (const room of rooms || []) {
      const updatedMembers = room.members.filter((m) => m !== key);
      const { error: updateErr } = await supabase.from("rooms").update({ members: updatedMembers }).eq("id", room.id);
      if (updateErr) throw updateErr;
    }

    // Remove the account itself. Past messages (public/DM/room) are left in
    // place on purpose so conversation history stays intact for others.
    const { error } = await supabase.from("users").delete().eq("username", key);
    if (error) throw error;
  },

  // ---------- Public room ----------
  async getPublicMessages(limit = 100) {
    const { data, error } = await supabase.from("public_messages").select("username,text,time").order("id", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).reverse();
  },

  async addPublicMessage(msg) {
    const { error } = await supabase.from("public_messages").insert({ username: msg.username, text: msg.text, time: msg.time });
    if (error) throw error;
  },

  // ---------- Direct messages ----------
  async getDM(userA, userB, limit = 200) {
    const [a, b] = dmPair(userA, userB);
    const { data, error } = await supabase
      .from("dms")
      .select("from_user,text,time")
      .eq("user_a", a)
      .eq("user_b", b)
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse().map((m) => ({ from: m.from_user, text: m.text, time: m.time }));
  },

  async addDM(userA, userB, msg) {
    const [a, b] = dmPair(userA, userB);
    const { error } = await supabase.from("dms").insert({ user_a: a, user_b: b, from_user: msg.from, text: msg.text, time: msg.time });
    if (error) throw error;
  },

  async listConversations(username) {
    const { data, error } = await supabase.from("dms").select("user_a,user_b").or(`user_a.eq.${username},user_b.eq.${username}`);
    if (error) throw error;
    const partners = new Set();
    (data || []).forEach((r) => {
      if (r.user_a === username) partners.add(r.user_b);
      else if (r.user_b === username) partners.add(r.user_a);
    });
    return Array.from(partners);
  },

  async listAllDmPairs() {
    const { data, error } = await supabase.from("dms").select("user_a,user_b,time").order("id", { ascending: true });
    if (error) throw error;
    const map = {};
    (data || []).forEach((r) => {
      const key = r.user_a + "|" + r.user_b;
      if (!map[key]) map[key] = { a: r.user_a, b: r.user_b, count: 0, lastAt: null };
      map[key].count++;
      map[key].lastAt = r.time;
    });
    return Object.values(map);
  },

  // ---------- Group rooms ----------
  async createRoom(name, members, createdBy) {
    const id = "room_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const { data, error } = await supabase
      .from("rooms")
      .insert({ id, name, members: Array.from(new Set(members)), created_by: createdBy })
      .select()
      .maybeSingle();
    if (error) throw error;
    return { id: data.id, name: data.name, members: data.members, createdBy: data.created_by, createdAt: new Date(data.created_at).getTime() };
  },

  async getRoom(id) {
    const { data, error } = await supabase.from("rooms").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, name: data.name, members: data.members, createdBy: data.created_by, createdAt: new Date(data.created_at).getTime() };
  },

  async listRoomsFor(username) {
    const { data, error } = await supabase.from("rooms").select("*").contains("members", [username]);
    if (error) throw error;
    return (data || []).map((r) => ({ id: r.id, name: r.name, members: r.members, createdBy: r.created_by, createdAt: new Date(r.created_at).getTime() }));
  },

  async listAllRooms() {
    const { data, error } = await supabase.from("rooms").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({ id: r.id, name: r.name, members: r.members, createdBy: r.created_by, createdAt: new Date(r.created_at).getTime() }));
  },

  async getRoomMessages(id, limit = 200) {
    const { data, error } = await supabase.from("room_messages").select("from_user,text,time").eq("room_id", id).order("id", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).reverse().map((m) => ({ from: m.from_user, text: m.text, time: m.time }));
  },

  async addRoomMessage(id, msg) {
    const { error } = await supabase.from("room_messages").insert({ room_id: id, from_user: msg.from, text: msg.text, time: msg.time });
    if (error) throw error;
  }
};
