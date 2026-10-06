const s=io(),$=x=>document.getElementById(x);let me="",room="",typing=new Set(),timer;
$("join").onsubmit=e=>{e.preventDefault();me=$("name").value.trim();room=$("room").value.trim().toUpperCase();if(me&&room)s.emit("join-room",{username:me,roomId:room})};
s.on("join-error",x=>alert(x));
s.on("room-joined",d=>{me=d.username;room=d.roomId;$("myname").textContent=me;$("me").textContent=initials(me);$("roomName").textContent=room;$("title").textContent=room;$("summary").textContent=d.users.length+" anggota aktif";$("landing").classList.add("hidden");$("app").classList.remove("hidden");$("messages").innerHTML="";d.messages.forEach(add);members(d.users);$("msg").focus()});
s.on("new-message",m=>{let w=document.querySelector(".welcome");if(w)w.remove();add(m);bottom()});
s.on("system-message",m=>{let x=document.createElement("div");x.className="system";x.textContent=m.text;$("messages").append(x);bottom()});
s.on("room-users",u=>members(u));
s.on("user-typing",d=>{if(d.isTyping)typing.add(d.username);else typing.delete(d.username);$("typing").textContent=typing.size?[...typing].slice(0,2).join(", ")+" sedang mengetik…":""});
$("send").onsubmit=e=>{e.preventDefault();let v=$("msg").value.trim();if(v)s.emit("send-message",v);$("msg").value="";s.emit("typing",false)};
$("msg").oninput=()=>{s.emit("typing",true);clearTimeout(timer);timer=setTimeout(()=>s.emit("typing",false),900)};
$("leave").onclick=()=>location.reload();
function initials(n){let p=n.split(/\s+/);return(p.length>1?p[0][0]+p[1][0]:n.slice(0,2)).toUpperCase()}
function add(m){let row=document.createElement("div");row.className="msg"+(m.userId===s.id||m.username===me?" mine":"");let a=document.createElement("div");a.className="ava";a.style.background=m.color||"#7c5cff";a.textContent=initials(m.username);let w=document.createElement("div");w.className="wrap";let meta=document.createElement("div");meta.className="meta";let n=document.createElement("strong");n.textContent=m.username===me?"Kamu":m.username;let t=document.createElement("time");t.textContent=new Date(m.time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});meta.append(n,t);let b=document.createElement("div");b.className="bubble";b.textContent=m.text;w.append(meta,b);row.append(a,w);$("messages").append(row)}
function members(u){$("count").textContent=u.length;$("summary").textContent=u.length+" anggota aktif";$("members").innerHTML="";u.forEach(x=>{let d=document.createElement("div");d.className="member";let a=document.createElement("b");a.textContent=initials(x.username);a.style.background=x.color;let sp=document.createElement("span");let n=document.createElement("strong");n.textContent=x.username;let st=document.createElement("small");st.textContent=x.username===me?"Kamu • aktif":"Aktif sekarang";sp.append(n,st);d.append(a,sp);$("members").append(d)})}
function bottom(){requestAnimationFrame(()=>$("messages").scrollTop=$("messages").scrollHeight)}
