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

const peers = new Map();
const videoElements = new Map();

let localStream = null;
let screenStream = null;
let roomId = null;
let userName = "";

let micEnabled = true;
let cameraEnabled = true;
let leaving = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function sanitizeRoom(value) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 50);
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

/* =========================================================
   MÍDIA LOCAL
========================================================= */

async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });

    micEnabled = true;
    cameraEnabled = true;

  } catch (error) {
    console.warn("Câmera + microfone indisponíveis:", error);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      cameraEnabled = false;
      toggleCamera.classList.remove("active");
      toggleCamera.textContent = "🚫";

    } catch (audioError) {
      alert(
        "Não foi possível acessar o microfone ou a câmera. " +
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

/* =========================================================
   VÍDEOS
========================================================= */

function addVideo(id, stream, name, muted = false) {
  let card = videoElements.get(id);

  if (!card) {
    card = document.createElement("div");
    card.className = "video-card";

    const video = document.createElement("video");

    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    const label = document.createElement("div");
    label.className = "video-name";
    label.textContent = name;

    card.appendChild(video);
    card.appendChild(label);

    videos.appendChild(card);

    videoElements.set(id, card);
  }

  const video = card.querySelector("video");

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  video.play().catch(() => {});

  updateEmptyState();
}

function removeVideo(id) {
  const card = videoElements.get(id);

  if (card) {
    card.remove();
    videoElements.delete(id);
  }

  updateEmptyState();
}

function removeAllRemoteVideos() {
  for (const id of [...videoElements.keys()]) {
    if (id !== socket.id) {
      removeVideo(id);
    }
  }
}

function updateEmptyState() {
  const remoteCount = Math.max(0, videoElements.size - 1);

  emptyState.classList.toggle(
    "hidden",
    remoteCount > 0
  );

  participantCount.textContent = remoteCount;
}

/* =========================================================
   WEBRTC
========================================================= */

function getCurrentVideoTrack() {
  if (screenStream) {
    const screenTrack = screenStream.getVideoTracks()[0];

    if (screenTrack) {
      return screenTrack;
    }
  }

  if (localStream) {
    return localStream.getVideoTracks()[0] || null;
  }

  return null;
}

async function createPeerConnection(remoteId, initiator) {
  if (peers.has(remoteId)) {
    return peers.get(remoteId);
  }

  const pc = new RTCPeerConnection(rtcConfig);

  /*
   * IMPORTANTE:
   * Se já estiver compartilhando a tela quando um novo
   * participante entrar, enviamos a tela para ele.
   */
  const videoTrack = getCurrentVideoTrack();

  if (videoTrack) {
    pc.addTrack(
      videoTrack,
      localStream
    );
  }

  if (localStream) {
    const audioTracks = localStream.getAudioTracks();

    audioTracks.forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = event => {
    if (!event.candidate) return;

    socket.emit("signal", {
      to: remoteId,
      data: {
        type: "candidate",
        candidate: event.candidate
      }
    });
  };

  pc.ontrack = event => {
    let stream;

    if (event.streams && event.streams[0]) {
      stream = event.streams[0];
    } else {
      stream = new MediaStream();

      if (event.track) {
        stream.addTrack(event.track);
      }
    }

    addVideo(
      remoteId,
      stream,
      "Participante"
    );
  };

  pc.onconnectionstatechange = () => {
    console.log(
      `Conexão ${remoteId}:`,
      pc.connectionState
    );

    if (
      ["failed", "closed"].includes(pc.connectionState)
    ) {
      closePeer(remoteId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(
      `ICE ${remoteId}:`,
      pc.iceConnectionState
    );
  };

  peers.set(remoteId, pc);

  if (initiator) {
    await renegotiatePeer(remoteId, pc);
  }

  return pc;
}

/*
 * Faz uma nova negociação WebRTC.
 * Isso é importante quando trocamos câmera <-> tela.
 */
async function renegotiatePeer(remoteId, pc) {
  if (!pc || pc.signalingState === "closed") {
    return;
  }

  try {
    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("signal", {
      to: remoteId,
      data: {
        type: "offer",
        offer: pc.localDescription
      }
    });

  } catch (error) {
    console.error(
      "Erro ao renegociar conexão:",
      error
    );
  }
}

async function handleSignal(from, data) {
  const pc = await createPeerConnection(
    from,
    false
  );

  if (data.type === "offer") {
    await pc.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );

    const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    socket.emit("signal", {
      to: from,
      data: {
        type: "answer",
        answer: pc.localDescription
      }
    });

    return;
  }

  if (data.type === "answer") {
    await pc.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );

    return;
  }

  if (
    data.type === "candidate" &&
    data.candidate
  ) {
    try {
      await pc.addIceCandidate(
        new RTCIceCandidate(data.candidate)
      );
    } catch (error) {
      console.warn(
        "ICE candidate ignorado:",
        error
      );
    }
  }
}

function closePeer(id) {
  const pc = peers.get(id);

  if (pc) {
    try {
      pc.close();
    } catch {}
  }

  peers.delete(id);
  removeVideo(id);
}

/* =========================================================
   ENTRAR NA SALA
========================================================= */

async function enterRoom(id) {
  if (leaving) {
    leaving = false;
  }

  roomId = sanitizeRoom(id);

  if (!roomId) {
    alert("Digite um código de sala válido.");
    return;
  }

  userName =
    nameInput.value.trim().slice(0, 40) ||
    "Usuário";

  createRoom.disabled = true;
  joinRoom.disabled = true;

  try {
    /*
     * CORREÇÃO DO BUG DE SAÍDA:
     * Se o socket estava desconectado, reconectamos
     * antes de entrar novamente.
     */
    if (!socket.connected) {
      socket.connect();

      await new Promise(resolve => {
        if (socket.connected) {
          resolve();
          return;
        }

        socket.once("connect", resolve);
      });
    }

    await startLocalMedia();

    currentRoom.textContent = roomId;

    lobby.classList.add("hidden");
    meeting.classList.remove("hidden");

    socket.emit(
      "join-room",
      roomId
    );

  } catch (error) {
    console.error(
      "Erro ao entrar na sala:",
      error
    );

    createRoom.disabled = false;
    joinRoom.disabled = false;
  }
}

createRoom.addEventListener(
  "click",
  () => {
    const id = makeRoomId();

    roomInput.value = id;

    enterRoom(id);
  }
);

joinRoom.addEventListener(
  "click",
  () => {
    enterRoom(roomInput.value);
  }
);

roomInput.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      enterRoom(roomInput.value);
    }
  }
);

nameInput.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      roomInput.focus();
    }
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

socket.on(
  "connect",
  () => {
    console.log(
      "Socket conectado:",
      socket.id
    );
  }
);

socket.on(
  "room-users",
  async users => {
    console.log(
      "Participantes encontrados:",
      users
    );

    for (const userId of users) {
      await createPeerConnection(
        userId,
        true
      );
    }
  }
);

socket.on(
  "user-joined",
  userId => {
    console.log(
      "Novo participante:",
      userId
    );

    /*
     * O participante novo vai receber nossa
     * mídia através da conexão criada por ele.
     */
  }
);

socket.on(
  "signal",
  async ({ from, data }) => {
    try {
      await handleSignal(
        from,
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

socket.on(
  "user-left",
  userId => {
    closePeer(userId);
  }
);

/* =========================================================
   MICROFONE
========================================================= */

toggleMic.addEventListener(
  "click",
  () => {
    if (!localStream) return;

    micEnabled = !micEnabled;

    localStream
      .getAudioTracks()
      .forEach(track => {
        track.enabled = micEnabled;
      });

    toggleMic.textContent =
      micEnabled ? "🎤" : "🔇";

    toggleMic.classList.toggle(
      "active",
      micEnabled
    );
  }
);

/* =========================================================
   CÂMERA
========================================================= */

toggleCamera.addEventListener(
  "click",
  () => {
    if (!localStream) return;

    cameraEnabled = !cameraEnabled;

    localStream
      .getVideoTracks()
      .forEach(track => {
        track.enabled = cameraEnabled;
      });

    toggleCamera.textContent =
      cameraEnabled ? "📷" : "🚫";

    toggleCamera.classList.toggle(
      "active",
      cameraEnabled
    );
  }
);

/* =========================================================
   COMPARTILHAMENTO DE TELA
========================================================= */

shareScreen.addEventListener(
  "click",
  async () => {
    if (!localStream) return;

    if (screenStream) {
      await stopScreenSharing();
      return;
    }

    /*
     * Detecta se o navegador oferece
     * compartilhamento de tela.
     */
    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getDisplayMedia
    ) {
      alert(
        "Seu navegador ou dispositivo não oferece " +
        "compartilhamento de tela."
      );

      return;
    }

    try {
      /*
       * Video é obrigatório.
       *
       * Audio é opcional porque alguns celulares/
       * navegadores não permitem áudio da tela.
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
        screenStream.getVideoTracks()[0];

      if (!screenTrack) {
        throw new Error(
          "Nenhuma faixa de vídeo foi obtida."
        );
      }

      /*
       * Mostra nossa própria tela.
       */
      const localVideo =
        videoElements
          .get(socket.id)
          ?.querySelector("video");

      if (localVideo) {
        localVideo.srcObject =
          screenStream;

        localVideo.play().catch(() => {});
      }

      /*
       * Troca câmera pela tela em TODAS
       * as conexões existentes.
       */
      for (const [
        remoteId,
        pc
      ] of peers.entries()) {

        const sender =
          pc
            .getSenders()
            .find(
              sender =>
                sender.track &&
                sender.track.kind === "video"
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
         * Renegocia para garantir que
         * todos recebam a tela.
         */
        await renegotiatePeer(
          remoteId,
          pc
        );
      }

      shareScreen.textContent = "⏹️";
      shareScreen.classList.add(
        "active"
      );

      /*
       * Se o usuário clicar em "Parar de
       * compartilhar" pelo próprio navegador,
       * também encerramos aqui.
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

/* =========================================================
   PARAR COMPARTILHAMENTO
========================================================= */

async function stopScreenSharing() {
  if (!screenStream) {
    return;
  }

  const oldScreenStream =
    screenStream;

  screenStream = null;

  oldScreenStream
    .getTracks()
    .forEach(track => {
      track.onended = null;
      track.stop();
    });

  const cameraTrack =
    localStream?.getVideoTracks()[0];

  /*
   * Volta para a câmera em todas
   * as conexões.
   */
  for (const [
    remoteId,
    pc
  ] of peers.entries()) {

    const sender =
      pc
        .getSenders()
        .find(
          sender =>
            sender.track &&
            sender.track.kind === "video"
        );

    if (sender && cameraTrack) {
      await sender.replaceTrack(
        cameraTrack
      );

      await renegotiatePeer(
        remoteId,
        pc
      );
    }
  }

  const localVideo =
    videoElements
      .get(socket.id)
      ?.querySelector("video");

  if (
    localVideo &&
    localStream
  ) {
    localVideo.srcObject =
      localStream;

    localVideo.play().catch(() => {});
  }

  shareScreen.textContent = "🖥️";

  shareScreen.classList.remove(
    "active"
  );
}

/* =========================================================
   CHAT
========================================================= */

chatForm.addEventListener(
  "submit",
  event => {
    event.preventDefault();

    const message =
      chatInput.value.trim();

    if (!message || !roomId) {
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

    chatInput.value = "";
  }
);

socket.on(
  "chat-message",
  data => {
    const item =
      document.createElement("div");

    item.className = "message";

    const author =
      document.createElement("div");

    author.className = "author";
    author.textContent = data.name;

    const text =
      document.createElement("div");

    text.className = "text";
    text.textContent = data.message;

    item.appendChild(author);
    item.appendChild(text);

    messages.appendChild(item);

    messages.scrollTop =
      messages.scrollHeight;
  }
);

/* =========================================================
   COPIAR CONVITE
========================================================= */

copyRoom.addEventListener(
  "click",
  async () => {
    if (!roomId) return;

    const url =
      `${location.origin}${location.pathname}` +
      `?room=${encodeURIComponent(roomId)}`;

    try {
      await navigator.clipboard.writeText(
        url
      );

      copyRoom.textContent =
        "Copiado!";

      setTimeout(() => {
        copyRoom.textContent =
          "Copiar convite";
      }, 1500);

    } catch {
      prompt(
        "Copie o convite:",
        url
      );
    }
  }
);

/* =========================================================
   SAIR DA CHAMADA
========================================================= */

async function leaveMeeting() {
  if (leaving) return;

  leaving = true;

  /*
   * Para o compartilhamento antes
   * de destruir a mídia.
   */
  if (screenStream) {
    await stopScreenSharing();
  }

  /*
   * Fecha todas as conexões WebRTC.
   */
  for (const id of [
    ...peers.keys()
  ]) {
    closePeer(id);
  }

  /*
   * Para câmera e microfone.
   */
  if (localStream) {
    localStream
      .getTracks()
      .forEach(track => {
        track.stop();
      });
  }

  localStream = null;
  screenStream = null;

  /*
   * Limpa vídeos.
   */
  removeAllRemoteVideos();

  const localCard =
    videoElements.get(socket.id);

  if (localCard) {
    localCard.remove();
    videoElements.delete(
      socket.id
    );
  }

  /*
   * Sai da sala no servidor.
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

  /*
   * NÃO usamos socket.disconnect().
   *
   * Esse era o principal motivo pelo qual
   * você precisava atualizar a página.
   *
   * O socket continua conectado e poderá
   * entrar em outra sala normalmente.
   */

  roomId = null;

  currentRoom.textContent = "";

  messages.innerHTML = "";

  roomInput.value = "";

  meeting.classList.add(
    "hidden"
  );

  lobby.classList.remove(
    "hidden"
  );

  createRoom.disabled = false;
  joinRoom.disabled = false;

  shareScreen.textContent = "🖥️";
  shareScreen.classList.remove(
    "active"
  );

  toggleMic.textContent = "🎤";
  toggleMic.classList.add("active");

  toggleCamera.textContent = "📷";
  toggleCamera.classList.add("active");

  micEnabled = true;
  cameraEnabled = true;

  updateEmptyState();

  leaving = false;
}

leaveCall.addEventListener(
  "click",
  leaveMeeting
);

/* =========================================================
   FECHAR A ABA
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {
    if (localStream) {
      localStream
        .getTracks()
        .forEach(track => {
          track.stop();
        });
    }
  }
);

/* =========================================================
   ABRIR SALA PELO LINK
========================================================= */

const params =
  new URLSearchParams(
    location.search
  );

const roomFromUrl =
  params.get("room");

if (roomFromUrl) {
  roomInput.value =
    sanitizeRoom(roomFromUrl);
}
