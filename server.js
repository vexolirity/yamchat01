const express=require("express");
const http=require("http");
const path=require("path");
const {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server);
const rooms=new Map();
app.use(express.static(path.join(__dirname,"public")));
const clean=(v,n=80)=>String(v??"").trim().replace(/\\s+/g," ").slice(0,n);
const room=id=>{if(!rooms.has(id))rooms.set(id,{messages:[],users:new Map()});return rooms.get(id)};
const users=r=>[...r.users.values()];
io.on("connection",socket=>{
 socket.on("join-room",({roomId,username})=>{
  roomId=clean(roomId,40).replace(/[^a-zA-Z0-9_-]/g,"-").toUpperCase(); username=clean(username,24);
  if(!roomId||!username)return socket.emit("join-error","Nama pengguna dan Room ID wajib diisi.");
  const r=room(roomId), color=["#7c5cff","#16c7b7","#ff7a59","#4d9fff","#d85cff"][Math.floor(Math.random()*5)];
  r.users.set(socket.id,{id:socket.id,username,color}); socket.join(roomId); socket.data={roomId,username};
  socket.emit("room-joined",{roomId,username,messages:r.messages.slice(-100),users:users(r)});
  socket.to(roomId).emit("system-message",{text:`${username} bergabung ke room.`});
  io.to(roomId).emit("room-users",users(r));
 });
 socket.on("send-message",text=>{
  const {roomId,username}=socket.data||{}; if(!roomId||!username)return;
  text=clean(text,1000); if(!text)return; const r=rooms.get(roomId),u=r.users.get(socket.id);
  const m={id:Date.now()+"-"+Math.random(),username,userId:socket.id,color:u?.color||"#7c5cff",text,time:Date.now()};
  r.messages.push(m); if(r.messages.length>200)r.messages.shift(); io.to(roomId).emit("new-message",m);
 });
 socket.on("typing",isTyping=>{if(socket.data?.roomId)socket.to(socket.data.roomId).emit("user-typing",{username:socket.data.username,isTyping:!!isTyping})});
 socket.on("disconnect",()=>{const {roomId,username}=socket.data||{},r=rooms.get(roomId);if(!r)return;r.users.delete(socket.id);socket.to(roomId).emit("system-message",{text:`${username} meninggalkan room.`});io.to(roomId).emit("room-users",users(r))});
});
server.listen(process.env.PORT||3000,()=>console.log("NEXUS: http://localhost:3000"));