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

io.on("connection", socket => {
  console.log("Usuário conectado:", socket.id);

  socket.on("join-room", payload => {
    const roomId = typeof payload === "string" ? payload : payload?.roomId;
    const name = typeof payload === "string" ? "Usuário" : payload?.name;

    if (!roomId || typeof roomId !== "string") return;

    const cleanName = String(name || "Usuário").trim().slice(0, 40) || "Usuário";
    const room = io.sockets.adapter.rooms.get(roomId);
    const users = room ? [...room] : [];

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = cleanName;

    socket.emit("room-users", users
      .filter(id => id !== socket.id)
      .map(id => ({
        id,
        name: io.sockets.sockets.get(id)?.data?.name || "Usuário"
      }))
    );

    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name: cleanName
    });

    socket.to(roomId).emit("participant-name", {
      id: socket.id,
      name: cleanName
    });

    console.log(`${cleanName} (${socket.id}) entrou na sala ${roomId}`);
  });

  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit("signal", {
      from: socket.id,
      data
    });
  });

  socket.on("media-state", ({ roomId, type, enabled }) => {
    const currentRoom = socket.data.roomId;
    if (!currentRoom || currentRoom !== roomId) return;

    socket.to(currentRoom).emit("media-state", {
      id: socket.id,
      type,
      enabled: Boolean(enabled)
    });
  });

  socket.on("chat-message", ({ roomId, message, name }) => {
    if (!roomId || !message || socket.data.roomId !== roomId) return;

    const cleanMessage = String(message).trim().slice(0, 500);
    const cleanName = String(name || socket.data.name || "Usuário").trim().slice(0, 40);

    if (!cleanMessage) return;

    io.to(roomId).emit("chat-message", {
      id: socket.id,
      name: cleanName,
      message: cleanMessage,
      time: new Date().toISOString()
    });
  });

  socket.on("leave-room", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit("user-left", socket.id);
    socket.leave(roomId);
    delete socket.data.roomId;
    delete socket.data.name;
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;

    if (roomId) socket.to(roomId).emit("user-left", socket.id);

    console.log("Usuário desconectado:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
