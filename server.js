const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
    res.json({
        ok: true
    });
});

io.on("connection", (socket) => {

    console.log("Usuário conectado:", socket.id);

    /*
    =========================================================
    ENTRAR NA SALA
    =========================================================
    */

    socket.on("join-room", ({ roomId, name }) => {

        if (!roomId || typeof roomId !== "string") {
            return;
        }

        const cleanRoom = roomId
            .trim()
            .slice(0, 50);

        const cleanName = String(name || "Usuário")
            .trim()
            .slice(0, 40);

        if (!cleanRoom) {
            return;
        }

        /*
        Se o usuário já estava em outra sala,
        removemos primeiro.
        */

        if (socket.data.roomId) {

            const oldRoom = socket.data.roomId;

            socket.leave(oldRoom);

            socket.to(oldRoom).emit("user-left", {
                id: socket.id
            });
        }

        /*
        Pegamos os participantes que já estavam
        na sala antes deste usuário entrar.
        */

        const room = io.sockets.adapter.rooms.get(cleanRoom);

        const users = room
            ? [...room]
                .filter(id => id !== socket.id)
                .map(id => {

                    const userSocket = io.sockets.sockets.get(id);

                    return {
                        id,
                        name: userSocket?.data?.name || "Usuário"
                    };

                })
            : [];

        /*
        Salvamos os dados do usuário.
        */

        socket.data.roomId = cleanRoom;
        socket.data.name = cleanName;

        socket.join(cleanRoom);

        /*
        Envia para o novo usuário quem já estava
        na sala.
        */

        socket.emit("room-users", users);

        /*
        Avisa os usuários existentes que alguém entrou.
        */

        socket.to(cleanRoom).emit("user-joined", {
            id: socket.id,
            name: cleanName
        });

        console.log(
            `${cleanName} (${socket.id}) entrou na sala ${cleanRoom}`
        );
    });


    /*
    =========================================================
    SAIR DA SALA
    =========================================================
    */

    socket.on("leave-room", (roomId) => {

        const currentRoom = socket.data.roomId;

        if (!currentRoom) {
            return;
        }

        if (roomId && roomId !== currentRoom) {
            return;
        }

        socket.leave(currentRoom);

        socket.to(currentRoom).emit("user-left", {
            id: socket.id
        });

        console.log(
            `${socket.data.name || "Usuário"} saiu da sala ${currentRoom}`
        );

        socket.data.roomId = null;
    });


    /*
    =========================================================
    WEBRTC - SINALIZAÇÃO
    =========================================================
    */

    socket.on("signal", ({ to, data }) => {

        if (!to || !data) {
            return;
        }

        io.to(to).emit("signal", {
            from: socket.id,
            fromName: socket.data.name || "Usuário",
            data
        });
    });


    /*
    =========================================================
    CHAT
    =========================================================
    */

    socket.on("chat-message", ({ roomId, message, name }) => {

        if (!roomId || !message) {
            return;
        }

        const cleanMessage = String(message)
            .trim()
            .slice(0, 500);

        const cleanName = String(
            name || socket.data.name || "Usuário"
        )
            .trim()
            .slice(0, 40);

        if (!cleanMessage) {
            return;
        }

        io.to(roomId).emit("chat-message", {

            id: socket.id,

            name: cleanName,

            message: cleanMessage,

            time: new Date().toISOString()

        });
    });


    /*
    =========================================================
    DESCONECTAR
    =========================================================
    */

    socket.on("disconnect", () => {

        const roomId = socket.data.roomId;

        if (roomId) {

            socket.to(roomId).emit("user-left", {
                id: socket.id
            });

        }

        console.log(
            "Usuário desconectado:",
            socket.data.name || socket.id
        );
    });

});


/*
=========================================================
SERVIDOR
=========================================================
*/

server.listen(PORT, () => {

    console.log(
        `Servidor rodando na porta ${PORT}`
    );

});
