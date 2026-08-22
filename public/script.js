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
const audioAnalyzers = new Map();
const zoomLevels = new Map();
const remoteNames = new Map();
const remoteScreenStates = new Map();

let localStream = null;
let screenStream = null;
let roomId = null;
let userName = "";
let micEnabled = true;
let cameraEnabled = true;
let audioContext = null;
let speakingLoopStarted = false;

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

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function startSpeakingDetection(id, stream) {
  if (!stream || audioAnalyzers.has(id)) return;

  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    audioAnalyzers.set(id, { source, analyser, data, speaking: false, quietFrames: 0 });

    if (!speakingLoopStarted) {
      speakingLoopStarted = true;
      requestAnimationFrame(updateSpeakingIndicators);
    }
  } catch (error) {
    console.warn("Não foi possível analisar o áudio:", error);
  }
}

function updateSpeakingIndicators() {
  for (const [id, info] of audioAnalyzers) {
    info.analyser.getByteTimeDomainData(info.data);

    let sum = 0;
    for (let i = 0; i < info.data.length; i++) {
      const value = (info.data[i] - 128) / 128;
      sum += value * value;
    }

    const rms = Math.sqrt(sum / info.data.length);
    const isSpeakingNow = rms > 0.055;

    if (isSpeakingNow) {
      info.quietFrames = 0;
    } else {
      info.quietFrames++;
    }

    if (isSpeakingNow && !info.speaking) {
      info.speaking = true;
      setSpeakingState(id, true);
    } else if (!isSpeakingNow && info.speaking && info.quietFrames > 12) {
      info.speaking = false;
      setSpeakingState(id, false);
    }
  }

  requestAnimationFrame(updateSpeakingIndicators);
}

function setSpeakingState(id, speaking) {
  const card = videoElements.get(id);
  if (!card) return;

  card.classList.toggle("speaking", speaking);

  const badge = card.querySelector(".speaking-badge");
  if (badge) {
    badge.classList.toggle("visible", speaking);
    badge.textContent = speaking ? "● Falando" : "";
  }
}

function stopSpeakingDetection(id) {
  const info = audioAnalyzers.get(id);
  if (!info) return;

  try {
    info.source.disconnect();
    info.analyser.disconnect();
  } catch {}

  audioAnalyzers.delete(id);
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
  startSpeakingDetection(socket.id, localStream);
}

function addVideo(id, stream, name, muted = false) {
  if (id !== socket.id && remoteNames.has(id)) name = remoteNames.get(id);
  let card = videoElements.get(id);

  if (!card) {
    card = document.createElement("div");
    card.className = "video-card";
    card.dataset.peerId = id;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    const label = document.createElement("div");
    label.className = "video-name";
    label.textContent = name;

    const speakingBadge = document.createElement("div");
    speakingBadge.className = "speaking-badge";

    const tools = document.createElement("div");
    tools.className = "video-tools";
    tools.innerHTML = `
      <button class="video-tool zoom-out" title="Diminuir zoom">−</button>
      <button class="video-tool zoom-reset" title="Restaurar zoom">100%</button>
      <button class="video-tool zoom-in" title="Aumentar zoom">+</button>
      <button class="video-tool pip-button" title="Abrir em janela flutuante">⛶</button>
    `;

    const zoomOut = tools.querySelector(".zoom-out");
    const zoomReset = tools.querySelector(".zoom-reset");
    const zoomIn = tools.querySelector(".zoom-in");
    const pipButton = tools.querySelector(".pip-button");

    zoomLevels.set(id, 1);

    zoomOut.addEventListener("click", () => changeZoom(id, -0.25));
    zoomIn.addEventListener("click", () => changeZoom(id, 0.25));
    zoomReset.addEventListener("click", () => setZoom(id, 1));
    pipButton.addEventListener("click", () => openPictureInPicture(id));

    card.appendChild(video);
    card.appendChild(label);
    card.appendChild(speakingBadge);
    card.appendChild(tools);
    videos.appendChild(card);

    videoElements.set(id, card);
  }

  const video = card.querySelector("video");
  video.srcObject = stream;

  startSpeakingDetection(id, stream);
  updateVideoTools(id);
  if (remoteScreenStates.has(id)) updateRemoteScreenState(id, remoteScreenStates.get(id));
  updateEmptyState();
}

function changeZoom(id, amount) {
  const current = zoomLevels.get(id) || 1;
  setZoom(id, current + amount);
}

function setZoom(id, value) {
  const zoom = Math.max(1, Math.min(3, Number(value.toFixed(2))));
  zoomLevels.set(id, zoom);

  const card = videoElements.get(id);
  if (!card) return;

  const video = card.querySelector("video");
  video.style.transform = `scale(${zoom})`;

  const reset = card.querySelector(".zoom-reset");
  if (reset) reset.textContent = `${Math.round(zoom * 100)}%`;

  updateVideoTools(id);
}

function updateVideoTools(id) {
  const card = videoElements.get(id);
  if (!card) return;

  const zoom = zoomLevels.get(id) || 1;
  const minus = card.querySelector(".zoom-out");
  const plus = card.querySelector(".zoom-in");

  if (minus) minus.disabled = zoom <= 1;
  if (plus) plus.disabled = zoom >= 3;
}

async function openPictureInPicture(id) {
  const card = videoElements.get(id);
  if (!card) return;

  const video = card.querySelector("video");

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }

    if (video.requestPictureInPicture) {
      await video.requestPictureInPicture();
      return;
    }

    if (video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode("picture-in-picture");
      return;
    }

    alert("Seu navegador não oferece janela flutuante para este vídeo.");
  } catch (error) {
    console.warn("Picture-in-Picture não disponível:", error);
  }
}

function setScreenShareState(isSharing) {
  const localCard = videoElements.get(socket.id);
  if (localCard) localCard.classList.toggle("screen-sharing", isSharing);

  socket.emit("media-state", {
    roomId,
    type: "screen",
    enabled: isSharing,
    name: userName
  });
}

function updateRemoteScreenState(id, enabled) {
  const card = videoElements.get(id);
  if (!card) return;

  card.classList.toggle("screen-sharing", enabled);

  const label = card.querySelector(".video-name");
  if (label) {
    const originalName = label.dataset.originalName || label.textContent.replace(" • Tela", "");
    label.dataset.originalName = originalName;
    label.textContent = enabled ? `${originalName} • Tela` : originalName;
  }
}

function removeVideo(id) {
  const card = videoElements.get(id);

  if (card) {
    card.remove();
    videoElements.delete(id);
  }

  stopSpeakingDetection(id);
  zoomLevels.delete(id);
  remoteNames.delete(id);
  remoteScreenStates.delete(id);
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
    addVideo(remoteId, stream, remoteNames.get(remoteId) || "Participante");
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

function resetMeetingUI() {
  videos.innerHTML = "";
  videoElements.clear();
  zoomLevels.clear();
  remoteNames.clear();
  remoteScreenStates.clear();
  for (const id of audioAnalyzers.keys()) stopSpeakingDetection(id);
  messages.innerHTML = "";
  currentRoom.textContent = "";
  shareScreen.textContent = "🖥️";
  shareScreen.classList.remove("active");
  toggleMic.textContent = "🎤";
  toggleMic.classList.add("active");
  toggleCamera.textContent = "📷";
  toggleCamera.classList.add("active");
  emptyState.classList.remove("hidden");
  participantCount.textContent = "0";
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
    if (socket.disconnected) socket.connect();
    await startLocalMedia();

    currentRoom.textContent = roomId;
    lobby.classList.add("hidden");
    meeting.classList.remove("hidden");

    socket.emit("join-room", { roomId, name: userName });
    saveRecentCall(roomId, userName);
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
  if (event.key === "Enter") enterRoom(roomInput.value);
});

nameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") roomInput.focus();
});

socket.on("room-users", async users => {
  for (const user of users) {
    const id = user.id || user;
    if (user.name) remoteNames.set(id, user.name);
    await createPeerConnection(id, true);
  }
});

socket.on("user-joined", user => {
  if (user?.id) remoteNames.set(user.id, user.name || "Participante");
  console.log("Novo participante:", user);
});

socket.on("participant-name", ({ id, name }) => {
  remoteNames.set(id, name || "Participante");
  const card = videoElements.get(id);
  if (!card) return;

  const label = card.querySelector(".video-name");
  if (label) {
    label.dataset.originalName = name;
    label.textContent = name;
  }
});

socket.on("media-state", ({ id, type, enabled }) => {
  if (type === "screen") {
    remoteScreenStates.set(id, Boolean(enabled));
    updateRemoteScreenState(id, Boolean(enabled));
  }
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
  localStream.getAudioTracks().forEach(track => track.enabled = micEnabled);

  toggleMic.textContent = micEnabled ? "🎤" : "🔇";
  toggleMic.classList.toggle("active", micEnabled);
});

toggleCamera.addEventListener("click", () => {
  if (!localStream) return;

  cameraEnabled = !cameraEnabled;
  localStream.getVideoTracks().forEach(track => track.enabled = cameraEnabled);

  toggleCamera.textContent = cameraEnabled ? "📷" : "🚫";
  toggleCamera.classList.toggle("active", cameraEnabled);
});

shareScreen.addEventListener("click", async () => {
  if (!localStream) return;

  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert("Seu navegador ou dispositivo não permite compartilhamento de tela.");
    return;
  }

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
      if (sender) await sender.replaceTrack(screenTrack);
    }

    const localVideo = videoElements.get(socket.id)?.querySelector("video");
    if (localVideo) localVideo.srcObject = screenStream;

    shareScreen.textContent = "⏹️";
    shareScreen.classList.add("active");
    setScreenShareState(true);

    screenTrack.onended = () => stopScreenSharing();
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
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
  }

  const localVideo = videoElements.get(socket.id)?.querySelector("video");
  if (localVideo && localStream) localVideo.srcObject = localStream;

  screenStream = null;
  shareScreen.textContent = "🖥️";
  shareScreen.classList.remove("active");
  setScreenShareState(false);

  const localCard = videoElements.get(socket.id);
  if (localCard) localCard.classList.remove("screen-sharing");
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
    setTimeout(() => copyRoom.textContent = "Copiar convite", 1500);
  } catch {
    prompt("Copie o convite:", url);
  }
});

function getRecentCalls() {
  try {
    return JSON.parse(localStorage.getItem("livecall_recent_calls") || "[]");
  } catch {
    return [];
  }
}

function saveRecentCall(room, name) {
  const calls = getRecentCalls().filter(item => item.room !== room);
  calls.unshift({ room, name, date: new Date().toISOString() });
  localStorage.setItem("livecall_recent_calls", JSON.stringify(calls.slice(0, 10)));
  renderRecentCalls();
}

function removeRecentCall(room) {
  const calls = getRecentCalls().filter(item => item.room !== room);
  localStorage.setItem("livecall_recent_calls", JSON.stringify(calls));
  renderRecentCalls();
}

function renderRecentCalls() {
  const container = document.getElementById("recentCalls");
  if (!container) return;

  const calls = getRecentCalls();
  container.innerHTML = "";

  if (!calls.length) {
    container.innerHTML = '<div class="no-recent">Nenhuma chamada recente.</div>';
    return;
  }

  calls.forEach(call => {
    const item = document.createElement("div");
    item.className = "recent-call";

    const info = document.createElement("div");
    info.className = "recent-info";
    info.innerHTML = `<strong>Sala ${escapeHtml(call.room)}</strong><span>${formatRecentDate(call.date)}</span>`;

    const enter = document.createElement("button");
    enter.className = "recent-enter";
    enter.textContent = "Entrar";
    enter.addEventListener("click", () => {
      roomInput.value = call.room;
      enterRoom(call.room);
    });

    const remove = document.createElement("button");
    remove.className = "recent-remove";
    remove.textContent = "×";
    remove.title = "Remover da biblioteca";
    remove.addEventListener("click", () => removeRecentCall(call.room));

    item.append(info, enter, remove);
    container.appendChild(item);
  });
}

function formatRecentDate(value) {
  try {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

async function leaveMeeting() {
  await stopScreenSharing();

  for (const id of peers.keys()) closePeer(id);

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (roomId) socket.emit("leave-room");

  roomId = null;
  userName = "";
  micEnabled = true;
  cameraEnabled = true;

  resetMeetingUI();

  meeting.classList.add("hidden");
  lobby.classList.remove("hidden");
  createRoom.disabled = false;
  joinRoom.disabled = false;
}

leaveCall.addEventListener("click", leaveMeeting);

window.addEventListener("beforeunload", () => {
  if (screenStream) screenStream.getTracks().forEach(track => track.stop());
  if (localStream) localStream.getTracks().forEach(track => track.stop());
});

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room");
if (roomFromUrl) roomInput.value = sanitizeRoom(roomFromUrl);

renderRecentCalls();
