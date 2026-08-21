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

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function sanitizeRoom(value) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50);
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });
  } catch (error) {
    console.error(error);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      cameraEnabled = false;
      toggleCamera.classList.remove("active");
    } catch (audioError) {
      alert("Não foi possível acessar câmera ou microfone. Verifique as permissões do navegador.");
      throw audioError;
    }
  }

  addVideo(socket.id, localStream, `${userName} (Você)`, true);
}

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
  video.srcObject = stream;

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

function updateEmptyState() {
  emptyState.classList.toggle("hidden", videoElements.size > 1);
  participantCount.textContent = Math.max(0, videoElements.size - 1);
}

async function createPeerConnection(remoteId, initiator) {
  if (peers.has(remoteId)) {
    return peers.get(remoteId);
  }

  const pc = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("signal", {
        to: remoteId,
        data: {
          type: "candidate",
          candidate: event.candidate
        }
      });
    }
  };

  pc.ontrack = event => {
    const stream = event.streams[0];
    addVideo(remoteId, stream, `Participante`);
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      closePeer(remoteId);
    }
  };

  peers.set(remoteId, pc);

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("signal", {
      to: remoteId,
      data: {
        type: "offer",
        offer: pc.localDescription
      }
    });
  }

  return pc;
}

async function handleSignal(from, data) {
  const pc = await createPeerConnection(from, false);

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("signal", {
      to: from,
      data: {
        type: "answer",
        answer: pc.localDescription
      }
    });
  }

  if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }

  if (data.type === "candidate" && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.warn("ICE candidate ignorado:", error);
    }
  }
}

function closePeer(id) {
  const pc = peers.get(id);

  if (pc) {
    pc.close();
    peers.delete(id);
  }

  removeVideo(id);
}

async function enterRoom(id) {
  roomId = sanitizeRoom(id);

  if (!roomId) {
    alert("Digite um código de sala válido.");
    return;
  }

  userName = nameInput.value.trim().slice(0, 40) || "Usuário";

  createRoom.disabled = true;
  joinRoom.disabled = true;

  try {
    await startLocalMedia();

    currentRoom.textContent = roomId;
    lobby.classList.add("hidden");
    meeting.classList.remove("hidden");

    socket.emit("join-room", roomId);
  } catch (error) {
    createRoom.disabled = false;
    joinRoom.disabled = false;
  }
}

createRoom.addEventListener("click", () => {
  const id = makeRoomId();
  roomInput.value = id;
  enterRoom(id);
});

joinRoom.addEventListener("click", () => {
  enterRoom(roomInput.value);
});

roomInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    enterRoom(roomInput.value);
  }
});

nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    roomInput.focus();
  }
});

socket.on("room-users", async users => {
  for (const userId of users) {
    await createPeerConnection(userId, true);
  }
});

socket.on("user-joined", async userId => {
  console.log("Novo participante:", userId);
});

socket.on("signal", async ({ from, data }) => {
  try {
    await handleSignal(from, data);
  } catch (error) {
    console.error("Erro na sinalização:", error);
  }
});

socket.on("user-left", userId => {
  closePeer(userId);
});

toggleMic.addEventListener("click", () => {
  if (!localStream) return;

  micEnabled = !micEnabled;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = micEnabled;
  });

  toggleMic.textContent = micEnabled ? "🎤" : "🔇";
  toggleMic.classList.toggle("active", micEnabled);
});

toggleCamera.addEventListener("click", () => {
  if (!localStream) return;

  cameraEnabled = !cameraEnabled;

  localStream.getVideoTracks().forEach(track => {
    track.enabled = cameraEnabled;
  });

  toggleCamera.textContent = cameraEnabled ? "📷" : "🚫";
  toggleCamera.classList.toggle("active", cameraEnabled);
});

shareScreen.addEventListener("click", async () => {
  if (!localStream) return;

  if (screenStream) {
    stopScreenSharing();
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    const screenTrack = screenStream.getVideoTracks()[0];

    for (const pc of peers.values()) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(screenTrack);
      }
    }

    const localVideo = videoElements.get(socket.id)?.querySelector("video");

    if (localVideo) {
      localVideo.srcObject = screenStream;
    }

    shareScreen.textContent = "⏹️";
    shareScreen.classList.add("active");

    screenTrack.onended = () => {
      stopScreenSharing();
    };
  } catch (error) {
    console.warn("Compartilhamento cancelado:", error);
  }
});

async function stopScreenSharing() {
  if (!screenStream) return;

  screenStream.getTracks().forEach(track => track.stop());

  const cameraTrack = localStream?.getVideoTracks()[0];

  for (const pc of peers.values()) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");

    if (sender && cameraTrack) {
      await sender.replaceTrack(cameraTrack);
    }
  }

  const localVideo = videoElements.get(socket.id)?.querySelector("video");

  if (localVideo && localStream) {
    localVideo.srcObject = localStream;
  }

  screenStream = null;
  shareScreen.textContent = "🖥️";
  shareScreen.classList.remove("active");
}

chatForm.addEventListener("submit", event => {
  event.preventDefault();

  const message = chatInput.value.trim();

  if (!message || !roomId) return;

  socket.emit("chat-message", {
    roomId,
    message,
    name: userName
  });

  chatInput.value = "";
});

socket.on("chat-message", data => {
  const item = document.createElement("div");
  item.className = "message";

  const author = document.createElement("div");
  author.className = "author";
  author.textContent = data.name;

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = data.message;

  item.appendChild(author);
  item.appendChild(text);
  messages.appendChild(item);

  messages.scrollTop = messages.scrollHeight;
});

copyRoom.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;

  try {
    await navigator.clipboard.writeText(url);
    copyRoom.textContent = "Copiado!";
    setTimeout(() => {
      copyRoom.textContent = "Copiar convite";
    }, 1500);
  } catch {
    prompt("Copie o convite:", url);
  }
});

function leaveMeeting() {
  stopScreenSharing();

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  for (const id of peers.keys()) {
    closePeer(id);
  }

  socket.disconnect();

  meeting.classList.add("hidden");
  lobby.classList.remove("hidden");
}

leaveCall.addEventListener("click", leaveMeeting);

window.addEventListener("beforeunload", () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
});

// Permite abrir diretamente uma sala usando ?room=CODIGO
const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room");

if (roomFromUrl) {
  roomInput.value = sanitizeRoom(roomFromUrl);
}