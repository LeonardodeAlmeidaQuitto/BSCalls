const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  console.log("Usuário conectado:", socket.id);

  socket.on("join-room", (roomId) => {
    if (!roomId || typeof roomId !== "string") return;

    const room = io.sockets.adapter.rooms.get(roomId);
    const users = room ? [...room] : [];

    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit("room-users", users.filter((id) => id !== socket.id));
    socket.to(roomId).emit("user-joined", socket.id);

    console.log(`${socket.id} entrou na sala ${roomId}`);
  });

  // Encaminha mensagens de sinalização WebRTC.
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
    const cleanName = String(name || "Usuário").trim().slice(0, 40);

    if (!cleanMessage) return;

    io.to(roomId).emit("chat-message", {
      id: socket.id,
      name: cleanName,
      message: cleanMessage,
      time: new Date().toISOString()
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;

    if (roomId) {
      socket.to(roomId).emit("user-left", socket.id);
    }

    console.log("Usuário desconectado:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});