const BACKEND = window.NEXUS_BACKEND || window.location.origin;
const s = io(BACKEND, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

const $ = (id) => document.getElementById(id);
let me = "", room = "", typing = new Set(), timer;

s.on("connect", () => console.log("✅ Connected to backend"));
s.on("connect_error", (err) => console.log("❌ Connect error:", err.message));
s.on("disconnect", () => console.log("❌ Disconnected"));

$("join").onsubmit = (e) => {
  e.preventDefault();
  me = $("name").value.trim();
  room = $("room").value.trim().toUpperCase();
  const pass = $("pass").value;
  console.log("📤 Join room:", { me, room, pass });
  if (me && room) s.emit("join-room", { username: me, roomId: room, password: pass });
};

s.on("join-error", (x) => alert("Gagal masuk: " + x));

s.on("room-joined", (d) => {
  console.log("✅ Room joined:", d);
  me = d.username;
  room = d.roomId;
  $("myname").textContent = me;
  $("me").textContent = initials(me);
  $("roomName").textContent = room;
  $("title").textContent = room;
  $("summary").textContent = d.users.length + " anggota aktif";
  $("landing").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("messages").innerHTML = "";
  d.messages.forEach(add);
  members(d.users);
  $("msg").focus();
});

s.on("new-message", (m) => {
  document.querySelector(".welcome")?.remove();
  add(m);
  bottom();
});

s.on("message-edited", (m) => {
  const el = document.querySelector(`[data-id="${m.id}"] .bubble`);
  if (el) el.textContent = m.text + " (diedit)";
});

s.on("message-deleted", (id) => {
  document.querySelector(`[data-id="${id}"]`)?.remove();
});

s.on("message-reacted", ({ id, reactions }) => {
  const el = document.querySelector(`[data-id="${id}"] .reactions`);
  if (el) el.textContent = Object.entries(reactions)
    .map(([e, u]) => `${e}${u.length}`).join(" ");
});

s.on("system-message", (m) => {
  const x = document.createElement("div");
  x.className = "system";
  x.textContent = m.text;
  $("messages").append(x);
  bottom();
});

s.on("room-users", (u) => members(u));
s.on("user-typing", (d) => {
  if (d.isTyping) typing.add(d.username);
  else typing.delete(d.username);
  $("typing").textContent = typing.size
    ? [...typing].slice(0, 2).join(", ") + " sedang mengetik…"
    : "";
});

$("send").onsubmit = (e) => {
  e.preventDefault();
  const v = $("msg").value.trim();
  if (v) s.emit("send-message", { text: v });
  $("msg").value = "";
  s.emit("typing", false);
};

$("msg").oninput = () => {
  s.emit("typing", true);
  clearTimeout(timer);
  timer = setTimeout(() => s.emit("typing", false), 900);
};

$("fileInput").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) return alert("File max 2MB");
  const reader = new FileReader();
  reader.onload = () => {
    s.emit("send-file", {
      name: f.name, type: f.type, data: reader.result, size: f.size,
    });
  };
  reader.readAsDataURL(f);
};

$("btnVideo").onclick = () => {
  const wrap = $("videoWrap");
  wrap.classList.toggle("hidden");
  if (!wrap.classList.contains("hidden")) {
    $("videoFrame").src = `https://meet.jit.si/NEXUS-${room}`;
  } else {
    $("videoFrame").src = "";
  }
};

$("leave").onclick = () => location.reload();

function initials(n) {
  const p = n.split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase();
}

function add(m) {
  const row = document.createElement("div");
  row.className = "msg" + (m.userId === s.id || m.username === me ? " mine" : "");
  row.dataset.id = m.id;

  const a = document.createElement("div");
  a.className = "ava";
  a.style.background = m.color || "#7c5cff";
  a.textContent = initials(m.username);

  const w = document.createElement("div");
  w.className = "wrap";

  const meta = document.createElement("div");
  meta.className = "meta";
  const n = document.createElement("strong");
  n.textContent = m.username === me ? "Kamu" : m.username;
  const t = document.createElement("time");
  t.textContent = new Date(m.time).toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit",
  });
  meta.append(n, t);

  const b = document.createElement("div");
  b.className = "bubble";

  if (m.type === "image") {
    const img = document.createElement("img");
    img.src = m.data;
    img.style.maxWidth = "240px";
    img.style.borderRadius = "10px";
    b.append(img);
  } else if (m.type === "file") {
    const link = document.createElement("a");
    link.href = m.data;
    link.download = m.name;
    link.textContent = "📎 " + m.name;
    link.style.color = "#a79cff";
    b.append(link);
  } else {
    b.textContent = m.text;
  }

  const reactions = document.createElement("div");
  reactions.className = "reactions";

  const reactBar = document.createElement("div");
  reactBar.className = "reactBar";
  ["👍", "❤️", "😂", "🔥"].forEach((e) => {
    const btn = document.createElement("span");
    btn.textContent = e;
    btn.style.cursor = "pointer";
    btn.style.marginRight = "4px";
    btn.onclick = () => s.emit("react-message", { id: m.id, emoji: e });
    reactBar.append(btn);
  });

  w.append(meta, b, reactions, reactBar);
  row.append(a, w);
  $("messages").append(row);
}

function members(u) {
  $("count").textContent = u.length;
  $("summary").textContent = u.length + " anggota aktif";
  $("members").innerHTML = "";
  u.forEach((x) => {
    const d = document.createElement("div");
    d.className = "member";
    const a = document.createElement("b");
    a.textContent = initials(x.username);
    a.style.background = x.color;
    const sp = document.createElement("span");
    const n = document.createElement("strong");
    n.textContent = x.username;
    const st = document.createElement("small");
    st.textContent = x.username === me ? "Kamu • aktif" : "Aktif sekarang";
    sp.append(n, st);
    d.append(a, sp);
    $("members").append(d);
  });
}

function bottom() {
  requestAnimationFrame(
    () => ($("messages").scrollTop = $("messages").scrollHeight)
  );
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
