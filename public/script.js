const socket = io({ autoConnect: true });

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
const callHistory = document.getElementById("callHistory");
const clearHistory = document.getElementById("clearHistory");

const toggleMic = document.getElementById("toggleMic");
const toggleCamera = document.getElementById("toggleCamera");
const shareScreen = document.getElementById("shareScreen");
const leaveCall = document.getElementById("leaveCall");
const copyRoom = document.getElementById("copyRoom");

const peers = new Map();
const participants = new Map();
const videoElements = new Map();
const pendingCandidates = new Map();

let localStream = null;
let screenStream = null;
let roomId = null;
let userName = "";
let micEnabled = true;
let cameraEnabled = true;
let isLeaving = false;
let joining = false;

const HISTORY_KEY = "livecall_history_v1";
const MAX_HISTORY = 20;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function sanitizeRoom(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 50);
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCallToHistory(id, name) {
  if (!id) return;

  const history = getHistory().filter(item => item.roomId !== id);
  history.unshift({
    roomId: id,
    name: name || "Usuário",
    lastUsed: Date.now()
  });

  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.slice(0, MAX_HISTORY))
  );

  renderCallHistory();
}

function removeCallFromHistory(id) {
  const history = getHistory().filter(item => item.roomId !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderCallHistory();
}

function renderCallHistory() {
  const history = getHistory();
  callHistory.innerHTML = "";

  if (!history.length) {
    callHistory.innerHTML = `<div class="history-empty">Nenhuma chamada salva ainda.</div>`;
    return;
  }

  history.forEach(item => {
    const row = document.createElement("div");
    row.className = "history-item";

    const info = document.createElement("div");
    info.className = "history-info";

    const title = document.createElement("strong");
    title.textContent = item.roomId;

    const date = document.createElement("span");
    date.textContent = `Última entrada: ${new Date(item.lastUsed).toLocaleString("pt-BR")}`;

    info.append(title, date);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const enter = document.createElement("button");
    enter.className = "history-enter";
    enter.textContent = "Entrar";
    enter.addEventListener("click", () => {
      roomInput.value = item.roomId;
      if (!nameInput.value.trim() && item.name) nameInput.value = item.name;
      enterRoom(item.roomId);
    });

    const remove = document.createElement("button");
    remove.className = "history-remove";
    remove.textContent = "×";
    remove.title = "Remover da biblioteca";
    remove.addEventListener("click", () => removeCallFromHistory(item.roomId));

    actions.append(enter, remove);
    row.append(info, actions);
    callHistory.appendChild(row);
  });
}

async function ensureSocketConnected() {
  if (socket.connected) return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo esgotado ao conectar ao servidor."));
    }, 10000);

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onError = error => {
      cleanup();
      reject(error || new Error("Não foi possível conectar."));
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
    socket.connect();
  });
}

async function startLocalMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador não permite acesso à câmera/microfone neste contexto.");
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });
    cameraEnabled = true;
  } catch (error) {
    console.warn("Câmera indisponível:", error);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      cameraEnabled = false;
      toggleCamera.classList.remove("active");
    } catch (audioError) {
      throw new Error("Não foi possível acessar câmera ou microfone. Verifique as permissões do navegador.");
    }
  }

  micEnabled = localStream.getAudioTracks().length > 0;
  toggleMic.classList.toggle("active", micEnabled);
  toggleCamera.classList.toggle("active", cameraEnabled);

  addVideo(socket.id, localStream, `${userName} (Você)`, true);
}

function addVideo(id, stream, name, muted = false) {
  let card = videoElements.get(id);

  if (!card) {
    card = document.createElement("div");
    card.className = "video-card";
    card.dataset.userId = id;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    const label = document.createElement("div");
    label.className = "video-name";
    label.textContent = name || "Usuário";

    card.append(video, label);
    videos.appendChild(card);
    videoElements.set(id, card);
  }

  const label = card.querySelector(".video-name");
  if (label && name) label.textContent = name;

  const video = card.querySelector("video");
  if (video.srcObject !== stream) video.srcObject = stream;
  video.play().catch(() => {});

  updateEmptyState();
}

function updateParticipantName(id, name) {
  participants.set(id, name || "Usuário");
  const card = videoElements.get(id);
  const label = card?.querySelector(".video-name");
  if (label) label.textContent = id === socket.id ? `${name} (Você)` : name;
}

function removeVideo(id) {
  const card = videoElements.get(id);
  if (card) card.remove();
  videoElements.delete(id);
  participants.delete(id);
  pendingCandidates.delete(id);
  updateEmptyState();
}

function updateEmptyState() {
  const remoteCount = Math.max(0, videoElements.size - 1);
  emptyState.classList.toggle("hidden", remoteCount > 0);
  participantCount.textContent = remoteCount;
}

async function createPeerConnection(remoteId, initiator, remoteName = "Usuário") {
  if (peers.has(remoteId)) return peers.get(remoteId);

  participants.set(remoteId, remoteName);
  const pc = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
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
    const stream = event.streams?.[0];
    if (!stream) return;
    addVideo(remoteId, stream, participants.get(remoteId) || remoteName || "Usuário");
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState)) {
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

async function flushCandidates(remoteId, pc) {
  const candidates = pendingCandidates.get(remoteId) || [];
  pendingCandidates.delete(remoteId);

  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn("ICE candidate ignorado:", error);
    }
  }
}

async function handleSignal(from, data) {
  const remoteName = participants.get(from) || "Usuário";
  const pc = await createPeerConnection(from, false, remoteName);

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    await flushCandidates(from, pc);

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
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    await flushCandidates(from, pc);
    return;
  }

  if (data.type === "candidate" && data.candidate) {
    if (pc.remoteDescription?.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.warn("ICE candidate ignorado:", error);
      }
    } else {
      if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
      pendingCandidates.get(from).push(data.candidate);
    }
  }
}

function closePeer(id) {
  const pc = peers.get(id);
  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
    peers.delete(id);
  }
  removeVideo(id);
}

async function enterRoom(id) {
  if (joining || roomId) return;

  const cleanRoom = sanitizeRoom(id);
  if (!cleanRoom) {
    alert("Digite um código de sala válido.");
    return;
  }

  userName = nameInput.value.trim().slice(0, 40) || "Usuário";
  nameInput.value = userName;
  roomInput.value = cleanRoom;

  joining = true;
  createRoom.disabled = true;
  joinRoom.disabled = true;

  try {
    await ensureSocketConnected();
    await startLocalMedia();

    roomId = cleanRoom;
    currentRoom.textContent = roomId;
    lobby.classList.add("hidden");
    meeting.classList.remove("hidden");
    saveCallToHistory(roomId, userName);

    socket.emit("join-room", {
      roomId,
      name: userName
    });
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível entrar na chamada.");
    cleanupMedia();
    roomId = null;
  } finally {
    joining = false;
    createRoom.disabled = false;
    joinRoom.disabled = false;
  }
}

createRoom.addEventListener("click", () => {
  const id = makeRoomId();
  roomInput.value = id;
  enterRoom(id);
});

joinRoom.addEventListener("click", () => enterRoom(roomInput.value));

roomInput.addEventListener("keydown", event => {
  if (event.key === "Enter") enterRoom(roomInput.value);
});

nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") roomInput.focus();
});

socket.on("room-users", async users => {
  for (const user of users) {
    participants.set(user.id, user.name || "Usuário");
    await createPeerConnection(user.id, true, user.name || "Usuário");
  }
});

socket.on("user-joined", ({ id, name }) => {
  participants.set(id, name || "Usuário");
});

socket.on("signal", async ({ from, data }) => {
  try {
    await handleSignal(from, data);
  } catch (error) {
    console.error("Erro na sinalização:", error);
  }
});

socket.on("user-left", userId => closePeer(userId));

socket.on("connect", () => {
  if (roomId && !isLeaving) {
    socket.emit("join-room", {
      roomId,
      name: userName
    });
  }
});

toggleMic.addEventListener("click", () => {
  if (!localStream) return;

  const tracks = localStream.getAudioTracks();
  if (!tracks.length) return;

  micEnabled = !micEnabled;
  tracks.forEach(track => track.enabled = micEnabled);

  toggleMic.textContent = micEnabled ? "🎤" : "🔇";
  toggleMic.classList.toggle("active", micEnabled);
});

toggleCamera.addEventListener("click", () => {
  if (!localStream) return;

  const tracks = localStream.getVideoTracks();
  if (!tracks.length) return;

  cameraEnabled = !cameraEnabled;
  tracks.forEach(track => track.enabled = cameraEnabled);

  toggleCamera.textContent = cameraEnabled ? "📷" : "🚫";
  toggleCamera.classList.toggle("active", cameraEnabled);
});

shareScreen.addEventListener("click", async () => {
  if (!localStream) return;

  if (screenStream) {
    await stopScreenSharing();
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert("Seu navegador/dispositivo não oferece compartilhamento de tela. Tente Chrome ou Edge no computador ou um navegador móvel que ofereça essa função.");
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) throw new Error("Nenhuma tela foi selecionada.");

    // Troca a faixa de vídeo em TODAS as conexões. Assim todos os participantes recebem a tela.
    for (const pc of peers.values()) {
      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        pc.addTrack(screenTrack, screenStream);
      }
    }

    const localVideo = videoElements.get(socket.id)?.querySelector("video");
    if (localVideo) localVideo.srcObject = screenStream;

    shareScreen.textContent = "⏹️";
    shareScreen.classList.add("active");

    screenTrack.addEventListener("ended", () => stopScreenSharing());
  } catch (error) {
    screenStream = null;
    console.warn("Compartilhamento cancelado/indisponível:", error);
  }
});

async function stopScreenSharing() {
  if (!screenStream) return;

  const oldScreen = screenStream;
  screenStream = null;
  oldScreen.getTracks().forEach(track => track.stop());

  const cameraTrack = localStream?.getVideoTracks()[0] || null;

  for (const pc of peers.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");

    if (sender && cameraTrack) {
      await sender.replaceTrack(cameraTrack);
    }
  }

  const localVideo = videoElements.get(socket.id)?.querySelector("video");
  if (localVideo && localStream) localVideo.srcObject = localStream;

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

  item.append(author, text);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
});

copyRoom.addEventListener("click", async () => {
  if (!roomId) return;

  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;

  try {
    await navigator.clipboard.writeText(url);
    copyRoom.textContent = "Copiado!";
    setTimeout(() => copyRoom.textContent = "Copiar convite", 1500);
  } catch {
    prompt("Copie o convite:", url);
  }
});

function cleanupMedia() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
}

function leaveMeeting() {
  if (isLeaving) return;
  isLeaving = true;

  stopScreenSharing().catch(() => {});

  if (roomId) socket.emit("leave-room");

  for (const id of [...peers.keys()]) closePeer(id);

  cleanupMedia();
  participants.clear();
  pendingCandidates.clear();

  roomId = null;
  currentRoom.textContent = "";
  videos.innerHTML = "";
  messages.innerHTML = "";
  updateEmptyState();

  meeting.classList.add("hidden");
  lobby.classList.remove("hidden");

  // IMPORTANTE: não usamos socket.disconnect().
  // Assim o usuário pode criar/entrar em outra sala sem atualizar a página.
  if (!socket.connected) socket.connect();

  isLeaving = false;
  renderCallHistory();
}

leaveCall.addEventListener("click", leaveMeeting);

window.addEventListener("beforeunload", () => {
  if (roomId) socket.emit("leave-room");
  cleanupMedia();
});

clearHistory.addEventListener("click", () => {
  if (!getHistory().length) return;
  if (!confirm("Apagar todas as chamadas salvas neste navegador?")) return;
  localStorage.removeItem(HISTORY_KEY);
  renderCallHistory();
});

// Abre automaticamente a sala recebida no convite.
const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room");
if (roomFromUrl) roomInput.value = sanitizeRoom(roomFromUrl);

const savedName = localStorage.getItem("livecall_name");
if (savedName) nameInput.value = savedName;

nameInput.addEventListener("change", () => {
  localStorage.setItem("livecall_name", nameInput.value.trim().slice(0, 40));
});

renderCallHistory();
