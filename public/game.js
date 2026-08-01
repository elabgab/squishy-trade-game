// =============================================
// Squishy Trade Game - Client Logic
// =============================================

const socket = io();

// ------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

// Lobby
const lobby = $("lobby");
const playerNameInput = $("playerName");
const roomInput = $("roomInput");
const createRoomBtn = $("createRoomBtn");
const joinRoomBtn = $("joinRoomBtn");
const lobbyMsg = $("lobbyMsg");

// Waiting
const waiting = $("waiting");
const roomCodeDisplay = $("roomCodeDisplay");
const leaveRoomBtn = $("leaveRoomBtn");

// Game
const game = $("game");
const gameRoomCode = $("gameRoomCode");
const opponentName = $("opponentName");
const opponentSquishies = $("opponentSquishies");
const opponentStatus = $("opponentStatus");
const myName = $("myName");
const mySquishies = $("mySquishies");
const myStatus = $("myStatus");
const tradeMessage = $("tradeMessage");
const tradeResult = $("tradeResult");
const uploadBtn = $("uploadBtn");
const addBtn = $("addBtn");
const acceptBtn = $("acceptBtn");
const declineBtn = $("declineBtn");
const myTurnHint = $("myTurnHint");
const fileInput = $("fileInput");

// Result overlay
const resultOverlay = $("resultOverlay");
const resultEmoji = $("resultEmoji");
const resultTitle = $("resultTitle");
const resultText = $("resultText");
const resultSquishies = $("resultSquishies");
const newTradeBtn = $("newTradeBtn");

// ------------------------------------------------------------
// Local state
// ------------------------------------------------------------
let playerIndex = null;      // 'p1' | 'p2'
let roomCode = null;
let opponentNameStr = "OPPONENT";
let myNameStr = "YOU";

// ------------------------------------------------------------
// Helper: render squishy cards
// ------------------------------------------------------------
function renderSquishies(container, images, emptyMsg) {
  container.innerHTML = "";
  if (!images || images.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-slot";
    empty.textContent = emptyMsg || "No squishies...";
    container.appendChild(empty);
    return;
  }
  images.forEach((src) => {
    const card = document.createElement("div");
    card.className = "squishy-card";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Squishy";
    card.appendChild(img);
    container.appendChild(card);
  });
}

// ------------------------------------------------------------
// Helper: reset action buttons
// ------------------------------------------------------------
function resetActions() {
  uploadBtn.disabled = true;
  addBtn.disabled = true;
  acceptBtn.disabled = true;
  declineBtn.disabled = true;
}

// ------------------------------------------------------------
// Screen switching
// ------------------------------------------------------------
function showScreen(screenId) {
  [lobby, waiting, game, resultOverlay].forEach((el) => hide(el));
  show(document.getElementById(screenId));
}

// ------------------------------------------------------------
// Lobby Events
// ------------------------------------------------------------
createRoomBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim() || "Player 1";
  myNameStr = name;
  createRoomBtn.disabled = true;
  lobbyMsg.textContent = "";
  socket.emit("createRoom", name, (res) => {
    createRoomBtn.disabled = false;
    if (res.ok) {
      playerIndex = res.playerIndex;
      roomCode = res.code;
      myName.textContent = myNameStr;
      showScreen("waiting");
      roomCodeDisplay.textContent = roomCode;
      gameRoomCode.textContent = "ROOM: " + roomCode;
    } else {
      lobbyMsg.textContent = res.error || "Failed to create room.";
    }
  });
});

joinRoomBtn.addEventListener("click", () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) { lobbyMsg.textContent = "Enter a room code!"; return; }
  const name = playerNameInput.value.trim() || "Player 2";
  myNameStr = name;
  joinRoomBtn.disabled = true;
  lobbyMsg.textContent = "";
  socket.emit("joinRoom", { code, playerName: name }, (res) => {
    joinRoomBtn.disabled = false;
    if (res.ok) {
      playerIndex = res.playerIndex;
      roomCode = res.code;
      myName.textContent = myNameStr;
      gameRoomCode.textContent = "ROOM: " + roomCode;
      showScreen("game");
      onGameStart();
    } else {
      lobbyMsg.textContent = res.error || "Failed to join room.";
    }
  });
});

// Enter key to join
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoomBtn.click();
});
playerNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createRoomBtn.click();
});

// Leave room
leaveRoomBtn.addEventListener("click", () => {
  window.location.reload();
});

// ------------------------------------------------------------
// Upload file handler
// ------------------------------------------------------------
uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // Tag the image with a timestamp to make it unique for ownership tracking
    const taggedUrl = dataUrl + "#t=" + Date.now();
    socket.emit("uploadOffer", taggedUrl, (res) => {
      if (!res.ok) {
        myTurnHint.textContent = "❌ " + (res.error || "Upload failed.");
      } else {
        myTurnHint.textContent = "✅ Squishy uploaded!";
        fileInput.value = "";
      }
    });
  };
  reader.readAsDataURL(file);
});

// ------------------------------------------------------------
// Action buttons (Add, Accept, Decline)
// ------------------------------------------------------------
addBtn.addEventListener("click", () => {
  addBtn.disabled = true;
  socket.emit("addRequest", (res) => {
    if (!res.ok) {
      myTurnHint.textContent = "❌ " + (res.error || "Add failed.");
      addBtn.disabled = false;
    }
  });
});

acceptBtn.addEventListener("click", () => {
  acceptBtn.disabled = true;
  myTurnHint.textContent = "⏳ Waiting for the other player to accept...";
  socket.emit("acceptTrade", (res) => {
    if (!res.ok) {
      acceptBtn.disabled = false;
      myTurnHint.textContent = "❌ " + (res.error || "Accept failed.");
    }
  });
});

declineBtn.addEventListener("click", () => {
  declineBtn.disabled = true;
  socket.emit("declineTrade", (res) => {
    if (!res.ok) {
      declineBtn.disabled = false;
      myTurnHint.textContent = "❌ " + (res.error || "Decline failed.");
    }
  });
});

// ------------------------------------------------------------
// New trade
// ------------------------------------------------------------
newTradeBtn.addEventListener("click", () => {
  socket.emit("restartTrade", (res) => {
    if (!res.ok) {
      myTurnHint.textContent = "❌ " + (res.error || "Restart failed.");
    }
  });
});

// ------------------------------------------------------------
// Determine turn hint
// ------------------------------------------------------------
function whoUploadsNext(state) {
  const pending = state.pendingAdd;
  if (!pending) return null;
  return pending === playerIndex ? "me" : "opponent";
}

function updateTradeMessage(state) {
  const pendingWho = whoUploadsNext(state);

  if (state.phase === "offers") {
    const myCount = (state.squishies[playerIndex] || []).length;
    const oppCount = (state.squishies[playerIndex === "p1" ? "p2" : "p1"] || []).length;

    if (myCount === 0 && oppCount === 0) {
      tradeMessage.textContent = "📍 Player 1 offers the first squishy!";
    } else if (myCount === 0 && oppCount > 0) {
      tradeMessage.textContent = waitingForMeToUpload()
        ? "🙌 Opponent offered! Upload your counter-offer."
        : "⏳ Waiting for your counter-offer...";
    } else if (myCount > 0 && oppCount === 0) {
      tradeMessage.textContent = "⏳ Waiting for " + opponentNameStr + " to upload a counter-offer...";
    } else {
      tradeMessage.textContent = "🤝 Both offers submitted — time to negotiate!";
    }
    return;
  }

  if (state.phase === "negotiating") {
    const myAccepted = state.accepted && state.accepted[playerIndex];
    const oppAccepted = state.accepted && state.accepted[playerIndex === "p1" ? "p2" : "p1"];

    if (pendingWho === "me") {
      tradeMessage.textContent = "📤 " + opponentNameStr + " wants more! Upload a squishy, Accept, or Decline.";
    } else if (pendingWho === "opponent") {
      tradeMessage.textContent = "⏳ Waiting for " + opponentNameStr + " to upload an added squishy...";
    } else if (myAccepted && !oppAccepted) {
      tradeMessage.textContent = "✅ You accepted! Waiting for " + opponentNameStr + "...";
    } else if (!myAccepted && oppAccepted) {
      tradeMessage.textContent = "👍 " + opponentNameStr + " accepted! Your move.";
    } else if (myAccepted && oppAccepted) {
      tradeMessage.textContent = "🎉 Both accepted! Finalizing...";
    } else {
      tradeMessage.textContent = "🤝 Negotiate — Accept, Add, or Decline.";
    }
    return;
  }

  if (state.phase === "success") {
    tradeMessage.textContent = "🎉 Trade Successful!";
    return;
  }
  if (state.phase === "bad") {
    tradeMessage.textContent = "💔 Trade Unsuccessful (Bad Trade)";
    return;
  }
  tradeMessage.textContent = "Waiting...";
}

function waitingForMeToUpload() {
  return myTurnHint.textContent.includes("your turn") || (opponentSquishies.children.length > 0 && mySquishies.children.length === 0);
}

// ------------------------------------------------------------
// Update action buttons based on state
// ------------------------------------------------------------
function updateActions(state) {
  resetActions();

  if (state.phase !== "offers" && state.phase !== "negotiating") {
    return;
  }

  const myAccepted = state.accepted && state.accepted[playerIndex];
  const pendingWho = whoUploadsNext(state);
  const mySquishyCount = (state.squishies[playerIndex] || []).length;
  const oppSquishyCount = (state.squishies[playerIndex === "p1" ? "p2" : "p1"] || []).length;

  // Upload button
  uploadBtn.disabled = pendingWho !== "me";

  // During offers phase, only upload is available (no accept/add/decline until both have offered)
  if (state.phase === "offers") {
    myTurnHint.textContent = pendingWho === "me"
      ? (mySquishyCount === 0 && oppSquishyCount === 0
          ? "🎯 It's your turn! Upload your primary squishy."
          : "🎯 Opponent made an offer! Upload your counter-offer.")
      : (mySquishyCount === 0
          ? "⏳ Uploading primary offer first, then waiting for opponent..."
          : "⏳ Waiting for opponent's counter-offer...");
    return;
  }

  // Negotiating phase — I was asked to add more squishies
  if (pendingWho === "me") {
    // The opponent requested an Add. I can respond three ways:
    //   1) UPLOAD another squishy (accept the add request)
    //   2) ACCEPT the trade as-is
    //   3) DECLINE to cancel the trade
    uploadBtn.disabled = false;
    acceptBtn.disabled = false;
    declineBtn.disabled = false;
    myTurnHint.textContent = "📤 " + opponentNameStr + " wants to add! Upload a squishy, Accept the trade, or Decline.";
    return;
  }

  if (pendingWho === "opponent") {
    myTurnHint.textContent = "⏳ Waiting for " + opponentNameStr + " to upload an added squishy...";
    return;
  }

  // Neither is uploading -> negotiation choices
  const canNegotiate = mySquishyCount > 0 && oppSquishyCount > 0;
  addBtn.disabled = !canNegotiate;
  declineBtn.disabled = !canNegotiate;
  acceptBtn.disabled = !canNegotiate || myAccepted;

  if (myAccepted) {
    myTurnHint.textContent = "✅ You accepted! Waiting for " + opponentNameStr + "...";
  } else {
    myTurnHint.textContent = "🤝 Your move: Accept, Add, or Decline.";
  }
}

// ------------------------------------------------------------
// Show result overlay
// ------------------------------------------------------------
function showResult(state) {
  const result = state.tradeResult;
  if (!result) return;

  if (state.phase === "success") {
    resultEmoji.textContent = "🎉";
    resultTitle.textContent = "TRADE SUCCESSFUL!";
    resultText.textContent = "Ownership exchanged! Your new squishies are shown below.";
  } else {
    resultEmoji.textContent = "💔";
    resultTitle.textContent = "TRADE UNSUCCESSFUL";
    resultText.textContent = "Bad Trade — all squishies returned to their original owners.";
  }

  // Show received / restored squishies
  const mySquishiesAfter = result.squishies && result.squishies[playerIndex];
  resultSquishies.innerHTML = "";

  const header = document.createElement("div");
  header.className = "result-sub";
  header.textContent = state.phase === "success" ? "✨ Squishies you received:" : "🔙 Squishies returned to you:";
  resultSquishies.appendChild(header);

  if (mySquishiesAfter && mySquishiesAfter.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "result-grid";
    mySquishiesAfter.forEach((src) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Squishy";
      wrap.appendChild(img);
    });
    resultSquishies.appendChild(wrap);
  } else {
    const empty = document.createElement("p");
    empty.textContent = "No squishies.";
    empty.className = "result-empty";
    resultSquishies.appendChild(empty);
  }

  show(resultOverlay);
}

// ------------------------------------------------------------
// On game start
// ------------------------------------------------------------
function onGameStart() {
  myTurnHint.textContent = "Loading...";
}

// ------------------------------------------------------------
// Socket events
// ------------------------------------------------------------

// Room state update
socket.on("roomState", (state) => {
  gameRoomCode.textContent = "ROOM: " + (state.code || "");

  // Waiting phase
  if (state.phase === "waiting") {
    if (waiting.classList.contains("hidden")) {
      showScreen("waiting");
      roomCodeDisplay.textContent = state.code;
    }
    return;
  }

  // Show game screen if not already
  if (game.classList.contains("hidden")) {
    showScreen("game");
    onGameStart();
  }

  const oppIdx = playerIndex === "p1" ? "p2" : "p1";

  // Find opponent name
  const oppPlayer = state.players.find((p) => {
    if (oppIdx === "p1") return p.isHost;
    return !p.isHost;
  });
  if (oppPlayer) {
    opponentName.textContent = (oppPlayer.name || "OPPONENT").toUpperCase();
    opponentNameStr = (oppPlayer.name || "OPPONENT").toUpperCase();
  }

  // Render squishies
  const mySquishiesArr = state.squishies[playerIndex] || [];
  const oppSquishiesArr = state.squishies[oppIdx] || [];

  renderSquishies(mySquishies, mySquishiesArr, "Upload your squishy...");
  renderSquishies(opponentSquishies, oppSquishiesArr, "Waiting for squishy...");

  // Update status pills
  const myAccepted = state.accepted && state.accepted[playerIndex];
  const oppAccepted = state.accepted && state.accepted[oppIdx];

  myStatus.textContent = myAccepted ? "Accepted" : "waiting";
  myStatus.className = "status-pill" + (myAccepted ? " active" : " waiting");

  opponentStatus.textContent = oppAccepted ? "Accepted" : "waiting";
  opponentStatus.className = "status-pill" + (oppAccepted ? " active" : " waiting");

  // Update trade message
  updateTradeMessage(state);

  // Update action buttons
  updateActions(state);

  // Handle result
  if (state.phase === "success" || state.phase === "bad") {
    showResult(state);
  }
});

// Opponent left
socket.on("opponentLeft", () => {
  myTurnHint.textContent = "❌ Opponent disconnected. Back to lobby...";
  setTimeout(() => window.location.reload(), 2000);
});

