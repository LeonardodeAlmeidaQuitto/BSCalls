const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.json({ ok: true }));

// socket.id -> { roomId, name }
const users = new Map();

function getRoomUsers(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room) return [];

  return [...room].map(id => ({
    id,
    name: users.get(id)?.name || "Usuário"
  }));
}

io.on("connection", socket => {
  console.log("Usuário conectado:", socket.id);

  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId || typeof roomId !== "string") return;

    const cleanRoom = roomId.trim().slice(0, 50);
    const cleanName = String(name || "Usuário").trim().slice(0, 40) || "Usuário";

    const oldRoom = socket.data.roomId;
    if (oldRoom && oldRoom !== cleanRoom) {
      socket.leave(oldRoom);
      socket.to(oldRoom).emit("user-left", socket.id);
    }

    const existingUsers = getRoomUsers(cleanRoom).filter(u => u.id !== socket.id);

    socket.join(cleanRoom);
    socket.data.roomId = cleanRoom;
    socket.data.name = cleanName;
    users.set(socket.id, { roomId: cleanRoom, name: cleanName });

    socket.emit("room-users", existingUsers);
    socket.to(cleanRoom).emit("user-joined", {
      id: socket.id,
      name: cleanName
    });

    console.log(`${cleanName} (${socket.id}) entrou na sala ${cleanRoom}`);
  });

  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit("signal", {
      from: socket.id,
      data
    });
  });

  socket.on("chat-message", ({ roomId, message, name }) => {
    if (!roomId || !message) return;

    const cleanMessage = String(message).trim().slice(0, 500);
    const cleanName = String(name || users.get(socket.id)?.name || "Usuário")
      .trim()
      .slice(0, 40);

    if (!cleanMessage) return;

    io.to(roomId).emit("chat-message", {
      id: socket.id,
      name: cleanName,
      message: cleanMessage,
      time: new Date().toISOString()
    });
  });

  socket.on("leave-room", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, true);
    users.delete(socket.id);
    console.log("Usuário desconectado:", socket.id);
  });
});

function leaveCurrentRoom(socket, alreadyDisconnected = false) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  if (!alreadyDisconnected) socket.leave(roomId);
  socket.to(roomId).emit("user-left", socket.id);

  socket.data.roomId = null;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
