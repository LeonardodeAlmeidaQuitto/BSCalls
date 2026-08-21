const socket = io();

const lobby = document.getElementById("lobby");
const meeting = document.getElementById("meeting");

const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");

const createRoom = document.getElementById("createRoom");
const joinRoom = document.getElementById("joinRoom");

const currentRoom = document.getElementById("currentRoom");

const videos = document.getElementById("videos");
const emptyState = document.getElementById("emptyState");

const messages = document.getElementById("messages");
const participantCount = document.getElementById("participantCount");

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const toggleMic = document.getElementById("toggleMic");
const toggleCamera = document.getElementById("toggleCamera");
const shareScreen = document.getElementById("shareScreen");
const leaveCall = document.getElementById("leaveCall");

const copyRoom = document.getElementById("copyRoom");

const historyContainer =
    document.getElementById("callHistory");


/*
=========================================================
ESTADO
=========================================================
*/

const peers = new Map();

const videoElements = new Map();

const remoteNames = new Map();

let localStream = null;

let screenStream = null;

let roomId = null;

let userName = "";

let micEnabled = true;

let cameraEnabled = true;

let leaving = false;


/*
=========================================================
CONFIGURAÇÃO WEBRTC
=========================================================
*/

const rtcConfig = {

    iceServers: [

        {
            urls: "stun:stun.l.google.com:19302"
        },

        {
            urls: "stun:stun1.l.google.com:19302"
        }

    ]

};


/*
=========================================================
HISTÓRICO
=========================================================
*/

const HISTORY_KEY = "bscalls_history";

const NAME_KEY = "bscalls_username";


function getHistory() {

    try {

        return JSON.parse(
            localStorage.getItem(HISTORY_KEY) || "[]"
        );

    } catch {

        return [];

    }

}


function saveHistory(history) {

    localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(history)
    );

}


function addToHistory(id) {

    const history = getHistory();

    const now = new Date();

    const existingIndex =
        history.findIndex(
            item => item.room === id
        );

    const item = {

        room: id,

        name: userName,

        lastAccess: now.toISOString()

    };


    if (existingIndex !== -1) {

        history.splice(
            existingIndex,
            1
        );

    }


    history.unshift(item);


    /*
    Mantém no máximo 20 salas.
    */

    saveHistory(
        history.slice(0, 20)
    );

    renderHistory();

}


function deleteHistory(room) {

    const history = getHistory()
        .filter(
            item => item.room !== room
        );

    saveHistory(history);

    renderHistory();

}


function formatDate(dateString) {

    try {

        return new Date(dateString)
            .toLocaleString(
                "pt-BR",
                {
                    dateStyle: "short",
                    timeStyle: "short"
                }
            );

    } catch {

        return "";

    }

}


function renderHistory() {

    if (!historyContainer) {
        return;
    }

    const history = getHistory();

    historyContainer.innerHTML = "";


    if (history.length === 0) {

        historyContainer.innerHTML = `
            <div class="history-empty">
                Nenhuma chamada anterior.
            </div>
        `;

        return;

    }


    history.forEach(item => {

        const card =
            document.createElement("div");

        card.className =
            "history-card";


        const info =
            document.createElement("div");

        info.className =
            "history-info";


        const title =
            document.createElement("strong");

        title.textContent =
            `Sala ${item.room}`;


        const date =
            document.createElement("span");

        date.textContent =
            `Último acesso: ${formatDate(item.lastAccess)}`;


        info.appendChild(title);

        info.appendChild(date);


        const actions =
            document.createElement("div");

        actions.className =
            "history-actions";


        const enterButton =
            document.createElement("button");

        enterButton.textContent =
            "Entrar";

        enterButton.className =
            "history-enter";


        enterButton.addEventListener(
            "click",
            () => {

                roomInput.value =
                    item.room;

                if (item.name) {

                    nameInput.value =
                        item.name;

                }

                enterRoom(item.room);

            }
        );


        const deleteButton =
            document.createElement("button");

        deleteButton.textContent =
            "Excluir";

        deleteButton.className =
            "history-delete";


        deleteButton.addEventListener(
            "click",
            () => {

                deleteHistory(
                    item.room
                );

            }
        );


        actions.appendChild(
            enterButton
        );

        actions.appendChild(
            deleteButton
        );


        card.appendChild(info);

        card.appendChild(actions);


        historyContainer.appendChild(card);

    });

}


/*
=========================================================
SALA
=========================================================
*/

function sanitizeRoom(value) {

    return value
        .trim()
        .replace(
            /[^a-zA-Z0-9_-]/g,
            "-"
        )
        .slice(0, 50);

}


function makeRoomId() {

    return Math.random()
        .toString(36)
        .slice(2, 8);

}


/*
=========================================================
MÍDIA LOCAL
=========================================================
*/

async function startLocalMedia() {

    if (!navigator.mediaDevices) {

        throw new Error(
            "Seu navegador não possui acesso às APIs de mídia."
        );

    }


    try {

        localStream =
            await navigator.mediaDevices.getUserMedia({

                audio: true,

                video: true

            });


        micEnabled = true;

        cameraEnabled = true;


    } catch (error) {

        console.warn(
            "Câmera + microfone indisponíveis:",
            error
        );


        try {

            localStream =
                await navigator.mediaDevices.getUserMedia({

                    audio: true,

                    video: false

                });


            cameraEnabled = false;

            toggleCamera.classList.remove(
                "active"
            );

            toggleCamera.textContent =
                "🚫";


        } catch (audioError) {

            alert(
                "Não foi possível acessar câmera/microfone. " +
                "Verifique as permissões do navegador."
            );

            throw audioError;

        }

    }


    addVideo(

        socket.id,

        localStream,

        `${userName} (Você)`,

        true

    );

}


/*
=========================================================
VÍDEOS
=========================================================
*/

function addVideo(
    id,
    stream,
    name,
    muted = false
) {

    let card =
        videoElements.get(id);


    if (!card) {

        card =
            document.createElement("div");

        card.className =
            "video-card";


        const video =
            document.createElement("video");

        video.autoplay = true;

        video.playsInline = true;

        video.muted = muted;


        const label =
            document.createElement("div");

        label.className =
            "video-name";

        label.textContent =
            name || "Usuário";


        card.appendChild(video);

        card.appendChild(label);


        videos.appendChild(card);


        videoElements.set(
            id,
            card
        );

    }


    const video =
        card.querySelector("video");


    const label =
        card.querySelector(".video-name");


    if (label) {

        label.textContent =
            name || "Usuário";

    }


    if (video.srcObject !== stream) {

        video.srcObject =
            stream;

    }


    video.play().catch(
        () => {}
    );


    updateEmptyState();

}


function updateVideoName(
    id,
    name
) {

    const card =
        videoElements.get(id);

    if (!card) {
        return;
    }


    const label =
        card.querySelector(
            ".video-name"
        );

    if (label) {

        label.textContent =
            name || "Usuário";

    }

}


function removeVideo(id) {

    const card =
        videoElements.get(id);


    if (card) {

        card.remove();

        videoElements.delete(id);

    }


    remoteNames.delete(id);

    updateEmptyState();

}


function removeAllRemoteVideos() {

    for (
        const id
        of [...videoElements.keys()]
    ) {

        if (id !== socket.id) {

            removeVideo(id);

        }

    }

}


function updateEmptyState() {

    const remoteCount =
        Math.max(
            0,
            videoElements.size - 1
        );


    if (emptyState) {

        emptyState.classList.toggle(
            "hidden",
            remoteCount > 0
        );

    }


    if (participantCount) {

        participantCount.textContent =
            remoteCount;

    }

}


/*
=========================================================
WEBRTC
=========================================================
*/

function getCurrentVideoTrack() {

    if (screenStream) {

        const track =
            screenStream
                .getVideoTracks()[0];

        if (track) {
            return track;
        }

    }


    if (localStream) {

        return (
            localStream
                .getVideoTracks()[0]
            || null
        );

    }


    return null;

}


function getCurrentVideoStream() {

    if (screenStream) {

        return screenStream;

    }


    return localStream;

}


async function createPeerConnection(
    remoteId,
    initiator,
    remoteName = null
) {

    if (remoteName) {

        remoteNames.set(
            remoteId,
            remoteName
        );

    }


    if (peers.has(remoteId)) {

        return peers.get(remoteId);

    }


    const pc =
        new RTCPeerConnection(
            rtcConfig
        );


    /*
    =====================================================
    ADICIONA VÍDEO ATUAL
    =====================================================
    */

    const videoTrack =
        getCurrentVideoTrack();

    const videoStream =
        getCurrentVideoStream();


    if (
        videoTrack &&
        videoStream
    ) {

        pc.addTrack(
            videoTrack,
            videoStream
        );

    }


    /*
    =====================================================
    ADICIONA ÁUDIO
    =====================================================
    */

    if (localStream) {

        localStream
            .getAudioTracks()
            .forEach(track => {

                pc.addTrack(
                    track,
                    localStream
                );

            });

    }


    /*
    =====================================================
    ICE
    =====================================================
    */

    pc.onicecandidate =
        event => {

            if (!event.candidate) {
                return;
            }


            socket.emit(
                "signal",
                {

                    to: remoteId,

                    data: {

                        type: "candidate",

                        candidate:
                            event.candidate

                    }

                }
            );

        };


    /*
    =====================================================
    RECEBER VÍDEO/ÁUDIO
    =====================================================
    */

    pc.ontrack =
        event => {

            let stream;


            if (
                event.streams &&
                event.streams[0]
            ) {

                stream =
                    event.streams[0];

            } else {

                stream =
                    new MediaStream();

                if (event.track) {

                    stream.addTrack(
                        event.track
                    );

                }

            }


            const name =
                remoteNames.get(
                    remoteId
                ) || "Usuário";


            addVideo(
                remoteId,
                stream,
                name
            );

        };


    /*
    =====================================================
    ESTADO DA CONEXÃO
    =====================================================
    */

    pc.onconnectionstatechange =
        () => {

            console.log(
                `Conexão ${remoteId}:`,
                pc.connectionState
            );


            if (
                [
                    "failed",
                    "closed"
                ].includes(
                    pc.connectionState
                )
            ) {

                closePeer(
                    remoteId
                );

            }

        };


    peers.set(
        remoteId,
        pc
    );


    if (initiator) {

        await renegotiatePeer(
            remoteId,
            pc
        );

    }


    return pc;

}


/*
=========================================================
RENEGOCIAÇÃO
=========================================================
*/

async function renegotiatePeer(
    remoteId,
    pc
) {

    if (
        !pc ||
        pc.signalingState === "closed"
    ) {

        return;

    }


    /*
    Evita criar várias ofertas simultaneamente.
    */

    if (
        pc.signalingState !==
        "stable"
    ) {

        return;

    }


    try {

        const offer =
            await pc.createOffer();


        await pc.setLocalDescription(
            offer
        );


        socket.emit(
            "signal",
            {

                to: remoteId,

                data: {

                    type: "offer",

                    offer:
                        pc.localDescription

                }

            }
        );


    } catch (error) {

        console.error(
            "Erro ao renegociar:",
            error
        );

    }

}


/*
=========================================================
RECEBER SINAL
=========================================================
*/

async function handleSignal(
    from,
    fromName,
    data
) {

    if (fromName) {

        remoteNames.set(
            from,
            fromName
        );

        updateVideoName(
            from,
            fromName
        );

    }


    const pc =
        await createPeerConnection(
            from,
            false,
            fromName
        );


    /*
    OFERTA
    */

    if (data.type === "offer") {

        await pc.setRemoteDescription(
            new RTCSessionDescription(
                data.offer
            )
        );


        const answer =
            await pc.createAnswer();


        await pc.setLocalDescription(
            answer
        );


        socket.emit(
            "signal",
            {

                to: from,

                data: {

                    type: "answer",

                    answer:
                        pc.localDescription

                }

            }
        );


        return;

    }


    /*
    RESPOSTA
    */

    if (data.type === "answer") {

        if (
            pc.signalingState !==
            "have-local-offer"
        ) {

            return;

        }


        await pc.setRemoteDescription(
            new RTCSessionDescription(
                data.answer
            )
        );


        return;

    }


    /*
    ICE
    */

    if (
        data.type === "candidate" &&
        data.candidate
    ) {

        try {

            await pc.addIceCandidate(
                new RTCIceCandidate(
                    data.candidate
                )
            );

        } catch (error) {

            console.warn(
                "ICE ignorado:",
                error
            );

        }

    }

}


/*
=========================================================
FECHAR PEER
=========================================================
*/

function closePeer(id) {

    const pc =
        peers.get(id);


    if (pc) {

        try {

            pc.close();

        } catch {}

    }


    peers.delete(id);

    removeVideo(id);

}


/*
=========================================================
ENTRAR NA SALA
=========================================================
*/

async function enterRoom(id) {

    if (leaving) {

        leaving = false;

    }


    const cleanRoom =
        sanitizeRoom(id);


    if (!cleanRoom) {

        alert(
            "Digite um código de sala válido."
        );

        return;

    }


    userName =
        nameInput.value
            .trim()
            .slice(0, 40)
        || "Usuário";


    localStorage.setItem(
        NAME_KEY,
        userName
    );


    roomId =
        cleanRoom;


    createRoom.disabled = true;

    joinRoom.disabled = true;


    try {

        /*
        Reconecta automaticamente.
        */

        if (!socket.connected) {

            socket.connect();


            await new Promise(
                resolve => {

                    if (socket.connected) {

                        resolve();

                        return;

                    }


                    socket.once(
                        "connect",
                        resolve
                    );

                }
            );

        }


        /*
        Limpa conexão anterior,
        caso exista.
        */

        for (
            const id
            of [...peers.keys()]
        ) {

            closePeer(id);

        }


        await startLocalMedia();


        /*
        Salva no histórico.
        */

        addToHistory(
            cleanRoom
        );


        currentRoom.textContent =
            cleanRoom;


        lobby.classList.add(
            "hidden"
        );

        meeting.classList.remove(
            "hidden"
        );


        socket.emit(
            "join-room",
            {

                roomId: cleanRoom,

                name: userName

            }
        );


    } catch (error) {

        console.error(
            "Erro ao entrar:",
            error
        );


        createRoom.disabled =
            false;

        joinRoom.disabled =
            false;

    }

}


/*
=========================================================
CRIAR SALA
=========================================================
*/

createRoom.addEventListener(
    "click",
    () => {

        const id =
            makeRoomId();


        roomInput.value =
            id;


        enterRoom(id);

    }
);


/*
=========================================================
ENTRAR
=========================================================
*/

joinRoom.addEventListener(
    "click",
    () => {

        enterRoom(
            roomInput.value
        );

    }
);


/*
=========================================================
ENTER NO CAMPO
=========================================================
*/

roomInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter"
        ) {

            enterRoom(
                roomInput.value
            );

        }

    }
);


nameInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter"
        ) {

            roomInput.focus();

        }

    }
);


/*
=========================================================
SOCKET CONECTADO
=========================================================
*/

socket.on(
    "connect",
    () => {

        console.log(
            "Socket conectado:",
            socket.id
        );

    }
);


/*
=========================================================
USUÁRIOS DA SALA
=========================================================
*/

socket.on(
    "room-users",
    async users => {

        console.log(
            "Usuários:",
            users
        );


        for (
            const user
            of users
        ) {

            remoteNames.set(
                user.id,
                user.name
            );


            await createPeerConnection(

                user.id,

                true,

                user.name

            );

        }

    }
);


/*
=========================================================
NOVO USUÁRIO
=========================================================
*/

socket.on(
    "user-joined",
    user => {

        remoteNames.set(
            user.id,
            user.name
        );


        console.log(
            `${user.name} entrou.`
        );

    }
);


/*
=========================================================
SINALIZAÇÃO
=========================================================
*/

socket.on(
    "signal",
    async ({
        from,
        fromName,
        data
    }) => {

        try {

            await handleSignal(
                from,
                fromName,
                data
            );

        } catch (error) {

            console.error(
                "Erro na sinalização:",
                error
            );

        }

    }
);


/*
=========================================================
USUÁRIO SAIU
=========================================================
*/

socket.on(
    "user-left",
    user => {

        const id =
            typeof user === "string"
                ? user
                : user.id;


        closePeer(id);

    }
);


/*
=========================================================
MICROFONE
=========================================================
*/

toggleMic.addEventListener(
    "click",
    () => {

        if (!localStream) {
            return;
        }


        micEnabled =
            !micEnabled;


        localStream
            .getAudioTracks()
            .forEach(
                track => {

                    track.enabled =
                        micEnabled;

                }
            );


        toggleMic.textContent =
            micEnabled
                ? "🎤"
                : "🔇";


        toggleMic.classList.toggle(
            "active",
            micEnabled
        );

    }
);


/*
=========================================================
CÂMERA
=========================================================
*/

toggleCamera.addEventListener(
    "click",
    () => {

        if (!localStream) {
            return;
        }


        cameraEnabled =
            !cameraEnabled;


        localStream
            .getVideoTracks()
            .forEach(
                track => {

                    track.enabled =
                        cameraEnabled;

                }
            );


        toggleCamera.textContent =
            cameraEnabled
                ? "📷"
                : "🚫";


        toggleCamera.classList.toggle(
            "active",
            cameraEnabled
        );

    }
);


/*
=========================================================
COMPARTILHAR TELA
=========================================================
*/

shareScreen.addEventListener(
    "click",
    async () => {

        if (!localStream) {
            return;
        }


        /*
        Se já está compartilhando,
        para.
        */

        if (screenStream) {

            await stopScreenSharing();

            return;

        }


        /*
        Verifica suporte.
        */

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getDisplayMedia
        ) {

            alert(
                "Este navegador/dispositivo não oferece compartilhamento de tela."
            );

            return;

        }


        try {

            /*
            Solicita a tela.
            */

            screenStream =
                await navigator.mediaDevices.getDisplayMedia({

                    video: {

                        frameRate: {
                            ideal: 30,
                            max: 60
                        }

                    },

                    audio: true

                });


            const screenTrack =
                screenStream
                    .getVideoTracks()[0];


            if (!screenTrack) {

                throw new Error(
                    "Nenhuma tela foi selecionada."
                );

            }


            /*
            Mostra localmente.
            */

            const localCard =
                videoElements.get(
                    socket.id
                );


            const localVideo =
                localCard?.querySelector(
                    "video"
                );


            if (localVideo) {

                localVideo.srcObject =
                    screenStream;

                localVideo.play()
                    .catch(
                        () => {}
                    );

            }


            /*
            =================================================
            ENVIA A TELA PARA TODOS OS PARTICIPANTES
            =================================================
            */

            for (
                const [
                    remoteId,
                    pc
                ]
                of peers.entries()
            ) {

                const sender =
                    pc.getSenders()
                        .find(
                            sender =>
                                sender.track &&
                                sender.track.kind ===
                                "video"
                        );


                if (sender) {

                    await sender.replaceTrack(
                        screenTrack
                    );

                } else {

                    pc.addTrack(
                        screenTrack,
                        screenStream
                    );

                }


                /*
                Renegocia a conexão.
                */

                await renegotiatePeer(
                    remoteId,
                    pc
                );

            }


            shareScreen.textContent =
                "⏹️";


            shareScreen.classList.add(
                "active"
            );


            /*
            Se o usuário parar pelo
            botão do navegador.
            */

            screenTrack.onended =
                async () => {

                    await stopScreenSharing();

                };


        } catch (error) {

            console.warn(
                "Compartilhamento cancelado:",
                error
            );


            screenStream = null;

        }

    }
);


/*
=========================================================
PARAR COMPARTILHAMENTO
=========================================================
*/

async function stopScreenSharing() {

    if (!screenStream) {
        return;
    }


    const oldScreenStream =
        screenStream;


    screenStream =
        null;


    oldScreenStream
        .getTracks()
        .forEach(
            track => {

                track.onended =
                    null;

                track.stop();

            }
        );


    const cameraTrack =
        localStream
            ?.getVideoTracks()[0];


    /*
    Volta para câmera.
    */

    for (
        const [
            remoteId,
            pc
        ]
        of peers.entries()
    ) {

        const sender =
            pc.getSenders()
                .find(
                    sender =>
                        sender.track &&
                        sender.track.kind ===
                        "video"
                );


        if (
            sender &&
            cameraTrack
        ) {

            await sender.replaceTrack(
                cameraTrack
            );


            await renegotiatePeer(
                remoteId,
                pc
            );

        }

    }


    /*
    Mostra câmera novamente
    para nós mesmos.
    */

    const localCard =
        videoElements.get(
            socket.id
        );


    const localVideo =
        localCard?.querySelector(
            "video"
        );


    if (
        localVideo &&
        localStream
    ) {

        localVideo.srcObject =
            localStream;

        localVideo.play()
            .catch(
                () => {}
            );

    }


    shareScreen.textContent =
        "🖥️";


    shareScreen.classList.remove(
        "active"
    );

}


/*
=========================================================
CHAT
=========================================================
*/

chatForm.addEventListener(
    "submit",
    event => {

        event.preventDefault();


        const message =
            chatInput.value.trim();


        if (
            !message ||
            !roomId
        ) {

            return;

        }


        socket.emit(
            "chat-message",
            {

                roomId,

                message,

                name: userName

            }
        );


        chatInput.value =
            "";

    }
);


socket.on(
    "chat-message",
    data => {

        const item =
            document.createElement(
                "div"
            );


        item.className =
            "message";


        const author =
            document.createElement(
                "div"
            );


        author.className =
            "author";


        author.textContent =
            data.name;


        const text =
            document.createElement(
                "div"
            );


        text.className =
            "text";


        text.textContent =
            data.message;


        item.appendChild(
            author
        );


        item.appendChild(
            text
        );


        messages.appendChild(
            item
        );


        messages.scrollTop =
            messages.scrollHeight;

    }
);


/*
=========================================================
COPIAR CONVITE
=========================================================
*/

copyRoom.addEventListener(
    "click",
    async () => {

        if (!roomId) {
            return;
        }


        const url =
            `${location.origin}${location.pathname}` +
            `?room=${encodeURIComponent(roomId)}`;


        try {

            await navigator.clipboard.writeText(
                url
            );


            copyRoom.textContent =
                "Copiado!";


            setTimeout(
                () => {

                    copyRoom.textContent =
                        "Copiar convite";

                },
                1500
            );


        } catch {

            prompt(
                "Copie o convite:",
                url
            );

        }

    }
);


/*
=========================================================
SAIR DA CHAMADA
=========================================================
*/

async function leaveMeeting() {

    if (leaving) {
        return;
    }


    leaving = true;


    /*
    Para compartilhamento.
    */

    if (screenStream) {

        await stopScreenSharing();

    }


    /*
    Fecha WebRTC.
    */

    for (
        const id
        of [...peers.keys()]
    ) {

        closePeer(id);

    }


    /*
    Para câmera e microfone.
    */

    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                track => track.stop()
            );

    }


    localStream =
        null;

    screenStream =
        null;


    /*
    Limpa vídeos.
    */

    removeAllRemoteVideos();


    const localCard =
        videoElements.get(
            socket.id
        );


    if (localCard) {

        localCard.remove();

        videoElements.delete(
            socket.id
        );

    }


    /*
    Sai da sala.
    NÃO desconecta o socket.
    */

    if (
        socket.connected &&
        roomId
    ) {

        socket.emit(
            "leave-room",
            roomId
        );

    }


    roomId =
        null;


    remoteNames.clear();


    currentRoom.textContent =
        "";


    messages.innerHTML =
        "";


    roomInput.value =
        "";


    meeting.classList.add(
        "hidden"
    );


    lobby.classList.remove(
        "hidden"
    );


    createRoom.disabled =
        false;

    joinRoom.disabled =
        false;


    shareScreen.textContent =
        "🖥️";


    shareScreen.classList.remove(
        "active"
    );


    toggleMic.textContent =
        "🎤";


    toggleMic.classList.add(
        "active"
    );


    toggleCamera.textContent =
        "📷";


    toggleCamera.classList.add(
        "active"
    );


    micEnabled =
        true;


    cameraEnabled =
        true;

    updateEmptyState();
    renderHistory();

    leaving =  false;
}

leaveCall.addEventListener(
    "click",
    leaveMeeting
);

/*
=========================================================
FECHAR ABA
=========================================================
*/
window.addEventListener(
    "beforeunload",
    () => {
        if (localStream) {
            localStream
                .getTracks()
                .forEach(
                    track => track.stop()
                );
        }
    }
);

/*
=========================================================
NOME SALVO
=========================================================
*/
const savedName =
    localStorage.getItem(
        NAME_KEY
    );

if (savedName) {
    nameInput.value =
        savedName;
}

/*
=========================================================
LINK COM SALA
=========================================================
*/
const params =
    new URLSearchParams(
        location.search
    );

const roomFromUrl =
    params.get("room");

if (roomFromUrl) {
    roomInput.value =
        sanitizeRoom(
            roomFromUrl
        );
}
/*
=========================================================
INICIALIZA HISTÓRICO
=========================================================
*/
renderHistory();
