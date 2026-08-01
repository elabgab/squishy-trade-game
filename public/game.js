// =============================================
// Squishy Trade Game - Client Logic
// =============================================

const socket = io();

// ------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

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
const resultEndBtn = $("resultEndBtn");

// Player controls
const leaveBtn = $("leaveBtn");
const endTradeBtn = $("endTradeBtn");

// Confirm overlay
const confirmOverlay = $("confirmOverlay");
const confirmEmoji = $("confirmEmoji");
const confirmTitle = $("confirmTitle");
const confirmText = $("confirmText");
const confirmVotes = $("confirmVotes");
const confirmYesBtn = $("confirmYesBtn");
const confirmNoBtn = $("confirmNoBtn");

// Showcase overlay
const showcaseOverlay = $("showcaseOverlay");
const showcaseSub = $("showcaseSub");
const screenshotBtn = $("screenshotBtn");
const myScreenshots = $("myScreenshots");
const showcaseReceived = $("showcaseReceived");
const ratingRows = $("ratingRows");
const showcaseRating = $("showcaseRating");
const showcaseRatingLabel = $("showcaseRatingLabel");
const submitRatingBtn = $("submitRatingBtn");
const showcaseDoneBtn = $("showcaseDoneBtn");
const screenshotInput = $("screenshotInput");

// ------------------------------------------------------------
// Local state
// ------------------------------------------------------------
let playerIndex = null;   // 'p1' | 'p2'
let roomCode = null;
let opponentNameStr = "OPPONENT";
let myNameStr = "YOU";
let confirmMode = null;   // 'leave' | 'end'
const rated = {};         // players who already submitted a rating

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
// Note: all user-supplied text is rendered with textContent,
// which is inherently HTML-safe, so no manual escaping is needed.

// The uploader strips the ? and # parts from data URLs before
// inserting them into <img> tags (fragments don't belong on data: URLs).
function cleanUrl(url) {
  if (!url) return "";
  const idx = url.search(/[?#]/);
  return idx === -1 ? url : url.slice(0, idx);
}

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
    img.src = cleanUrl(src);
    img.alt = "Squishy";
    card.appendChild(img);
    container.appendChild(card);
  });
}

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
  [lobby, waiting, game].forEach((el) => hide(el));
  [resultOverlay, confirmOverlay, showcaseOverlay].forEach((el) => hide(el));
  show(document.getElementById(screenId));
}

// ------------------------------------------------------------
// Lobby events
// ------------------------------------------------------------
createRoomBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim() || "Player 1";
  myNameStr = name;
  createRoomBtn.disabled = true;
  lobbyMsg.textContent = "";
  socket.emit("createRoom", name, (res) => {
    createRoomBtn.disabled = false;
    if (res && res.ok) {
      playerIndex = res.playerIndex;
      roomCode = res.code;
      myName.textContent = myNameStr;
      showScreen("waiting");
      roomCodeDisplay.textContent = roomCode;
      gameRoomCode.textContent = "ROOM: " + roomCode;
    } else {
      lobbyMsg.textContent = (res && res.error) || "Failed to create room.";
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
    if (res && res.ok) {
      playerIndex = res.playerIndex;
      roomCode = res.code;
      myName.textContent = myNameStr;
      gameRoomCode.textContent = "ROOM: " + roomCode;
      showScreen("game");
    } else {
      lobbyMsg.textContent = (res && res.error) || "Failed to join room.";
    }
  });
});

roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoomBtn.click(); });
playerNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createRoomBtn.click(); });

leaveRoomBtn.addEventListener("click", () => window.location.reload());

// ------------------------------------------------------------
// Upload file handler  (squishy)
// ------------------------------------------------------------
uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Compress to max 500x500 before sending.
      const MAX = 500;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const compressedUrl = canvas.toDataURL("image/jpeg", 0.85);
      // Timestamp fragment makes each URL unique for ownership tracking.
      const taggedUrl = cleanUrl(compressedUrl) + "#t=" + Date.now();
      socket.emit("uploadOffer", taggedUrl, (res) => {
        if (!res || !res.ok) {
          myTurnHint.textContent = "❌ " + ((res && res.error) || "Upload failed.");
        } else {
          myTurnHint.textContent = "✅ Squishy uploaded!";
          fileInput.value = "";
        }
      });
    };
    img.onerror = () => {
      myTurnHint.textContent = "❌ Could not read that image.";
      fileInput.value = "";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// ------------------------------------------------------------
// Screenshot handler (showcase)
// ------------------------------------------------------------
screenshotBtn.addEventListener("click", () => screenshotInput.click());

screenshotInput.addEventListener("change", () => {
  const file = screenshotInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 500;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const pushed = cleanUrl(canvas.toDataURL("image/jpeg", 0.85)) + "#t=" + Date.now();
      socket.emit("uploadScreenshot", pushed, (res) => {
        if (!res || !res.ok) {
          showcaseSub.textContent = "❌ " + ((res && res.error) || "Upload failed.");
        } else {
          showcaseSub.textContent = "📸 Screenshot added!";
          screenshotInput.value = "";
        }
      });
    };
    img.onerror = () => { showcaseSub.textContent = "❌ Could not read that image."; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// ------------------------------------------------------------
// Action buttons (Add, Accept, Decline)
// ------------------------------------------------------------
addBtn.addEventListener("click", () => {
  addBtn.disabled = true;
  socket.emit("addRequest", (res) => {
    if (!res || !res.ok) {
      myTurnHint.textContent = "❌ " + ((res && res.error) || "Add failed.");
      addBtn.disabled = false;
    }
  });
});

acceptBtn.addEventListener("click", () => {
  acceptBtn.disabled = true;
  myTurnHint.textContent = "⏳ Waiting for the other player to accept...";
  socket.emit("acceptTrade", (res) => {
    if (!res || !res.ok) {
      acceptBtn.disabled = false;
      myTurnHint.textContent = "❌ " + ((res && res.error) || "Accept failed.");
    }
  });
});

declineBtn.addEventListener("click", () => {
  declineBtn.disabled = true;
  socket.emit("declineTrade", (res) => {
    if (!res || !res.ok) {
      declineBtn.disabled = false;
      myTurnHint.textContent = "❌ " + ((res && res.error) || "Decline failed.");
    }
  });
});

// ------------------------------------------------------------
// New trade
// ------------------------------------------------------------
newTradeBtn.addEventListener("click", () => {
  hide(resultOverlay);
  myTurnHint.textContent = "";
  socket.emit("restartTrade", (res) => {
    if (!res || !res.ok) {
      myTurnHint.textContent = "❌ " + ((res && res.error) || "Restart failed.");
      show(resultOverlay);
    }
  });
});

// End trade (from result overlay)
resultEndBtn.addEventListener("click", () => {
  socket.emit("endTrade", (res) => {
    if (!res || !res.ok) {
      myTurnHint.textContent = "❌ " + ((res && res.error) || "End failed.");
    }
  });
});

// Showcase done button
showcaseDoneBtn.addEventListener("click", () => {
  hide(showcaseOverlay);
  myTurnHint.textContent = "";
  socket.emit("restartTrade", (res) => {
    if (!res || !res.ok) {
      show(showcaseOverlay);
    }
  });
});

// ------------------------------------------------------------
// Leave / End trade buttons (bottom of my area)
// ------------------------------------------------------------
leaveBtn.addEventListener("click", () => {
  leaveBtn.disabled = true;
  socket.emit("leaveGame", (res) => {
    leaveBtn.disabled = false;
    if (res && res.ok && res.home) {
      // Everyone agreed to leave -> return to lobby.
      window.location.reload();
    }
  });
});

endTradeBtn.addEventListener("click", () => {
  endTradeBtn.disabled = true;
  socket.emit("endTrade", (res) => {
    endTradeBtn.disabled = false;
    if (!res || !res.ok) {
      myTurnHint.textContent = "❌ " + ((res && res.error) || "End failed.");
    }
  });
});

// ------------------------------------------------------------
// Confirm overlay (mutual agreement)
// ------------------------------------------------------------
confirmYesBtn.addEventListener("click", () => {
  if (confirmMode === "leave") socket.emit("leaveGame");
  else if (confirmMode === "end") socket.emit("endTrade");
  confirmNoBtn.disabled = false;
});

confirmNoBtn.addEventListener("click", () => {
  socket.emit("cancelVote");
  hide(confirmOverlay);
});

function openConfirm(mode, state) {
  confirmMode = mode;
  confirmYesBtn.disabled = false;
  confirmNoBtn.disabled = false;
  if (mode === "leave") {
    confirmEmoji.textContent = "👋";
    confirmTitle.textContent = "Leave Game?";
    confirmText.textContent = "Both players must agree to leave the game.";
  } else {
    confirmEmoji.textContent = "🏁";
    confirmTitle.textContent = "End Trade?";
    confirmText.textContent = "Both players must agree to end and showcase the trade.";
  }
  updateConfirmVotes(state);
  show(confirmOverlay);
}

function updateConfirmVotes(state) {
  if (!confirmOverlay.classList.contains("hidden")) {
    const votes = confirmMode === "leave" ? state.leaveVotes : state.endVotes;
    let txt = "";
    if (votes) {
      const me = votes[playerIndex] ? "✓" : "·";
      const opp = votes[playerIndex === "p1" ? "p2" : "p1"] ? "✓" : "·";
      txt = "You: " + me + "   Opponent: " + opp;
    }
    confirmVotes.textContent = txt;
  }
}

// ------------------------------------------------------------
// Rating
// ------------------------------------------------------------
function updateRatingLabel() {
  const v = Number(showcaseRating.value || "1");
  showcaseRatingLabel.textContent = v === 1 ? "GOOD TRADE 😊" : "BAD TRADE 😢";
}

if (showcaseRating) showcaseRating.addEventListener("input", updateRatingLabel);

submitRatingBtn.addEventListener("click", () => {
  const value = Number(showcaseRating.value || "1") === 1 ? "GOOD" : "BAD";
  submitRatingBtn.disabled = true;
  socket.emit("submitRating", value, (res) => {
    if (!res || !res.ok) {
      submitRatingBtn.disabled = false;
      showcaseSub.textContent = "❌ " + ((res && res.error) || "Rating failed.");
    }
  });
});

// ------------------------------------------------------------
// Showcase overlay
// ------------------------------------------------------------
function openShowcase(state) {
  const sc = state.showcase;
  if (!sc) return;
  showcaseSub.textContent = "Upload a screenshot of the squishies you got from the trade!";
  myScreenshots.innerHTML = "";
  (sc.screenshots[playerIndex] || []).forEach((src) => {
    const card = document.createElement("div");
    card.className = "squishy-card";
    const img = document.createElement("img");
    img.src = cleanUrl(src);
    img.alt = "Screenshot";
    card.appendChild(img);
    myScreenshots.appendChild(card);
  });

  const received = sc.received[playerIndex] || [];
  showcaseReceived.innerHTML = "";
  if (received.length === 0) {
    const empty = document.createElement("p");
    empty.className = "result-empty";
    empty.textContent = "No squishies received.";
    showcaseReceived.appendChild(empty);
  } else {
    received.forEach((src) => {
      const img = document.createElement("img");
      img.src = cleanUrl(src);
      img.alt = "Received";
      showcaseReceived.appendChild(img);
    });
  }

  // Rating rows
  ratingRows.innerHTML = "";
  for (const p of state.players) {
    const r = state.ratings ? state.ratings[p.id === (playerIndex === "p1" ? "p1" : "p1") ? "p1" : "p2"] : null;
    summaryHelper(state, ratingRows, r);
  }
  renderRatings(state);

  show(showcaseOverlay);
}

function summaryHelper(state, container, ratingValue) {
  // placeholder for helper below
}

function renderRatings(state) {
  const votes = state.ratings || {};
  const p1 = votes.p1;
  const p2 = votes.p2;
  ratingRows.innerHTML = "";
  const mk = (label, val) => {
    const row = document.createElement("div");
    row.className = "rating-row";
    row.textContent = label + ": " + (val ? (val === "GOOD" ? "👍 GOOD" : "👎 BAD") : "—");
    ratingRows.appendChild(row);
  };
  const myVote = votes[playerIndex];
  const oppVote = votes[playerIndex === "p1" ? "p2" : "p1"];
  if (myNameStr) mk(myNameStr + " (you)", myVote);
  if (opponentNameStr) mk(opponentNameStr, oppVote);

  submitRatingBtn.disabled = !!myVote;
  if (p1 === "GOOD" && p2 === "GOOD") {
    showcaseSub.textContent = "🎉 Both rated this trade GOOD!";
  } else if (p1 === "BAD" && p2 === "BAD") {
    showcaseSub.textContent = "💔 Both rated this trade BAD.";
  } else if (p1 || p2) {
    showcaseSub.textContent = "⭐ Waiting for the other player's rating...";
  } else {
    showcaseSub.textContent = "How was the trade? Rate it below!";
  }
}

// ------------------------------------------------------------
// Turn / state helpers
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
      const firstPlayer = state.pendingAdd === "p1" ? "Player 1" : "Player 2";
      tradeMessage.textContent = "📍 " + firstPlayer + " offers the first squishy!";
    } else if (myCount === 0 && oppCount > 0) {
      tradeMessage.textContent = "🙌 Opponent offered! Upload your counter-offer.";
    } else if (myCount > 0 && oppCount === 0) {
      tradeMessage.textContent = "⏳ Waiting for " + opponentNameStr + " to upload a counter-offer...";
    } else {
      tradeMessage.textContent = "🤝 Both offers submitted — time to negotiate!";
    }
    return;
  }

  if (state.phase === "negotiating") {
    const myAccepted = !!(state.accepted && state.accepted[playerIndex]);
    const oppAccepted = !!(state.accepted && state.accepted[playerIndex === "p1" ? "p2" : "p1"]);

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

  if (state.phase === "success") { tradeMessage.textContent = "🎉 Trade Successful!"; return; }
  if (state.phase === "bad") { tradeMessage.textContent = "💔 Trade Unsuccessful (Bad Trade)"; return; }
  tradeMessage.textContent = "Waiting...";
}

function updateActions(state) {
  resetActions();
  if (state.phase !== "offers" && state.phase !== "negotiating") return;

  const myAccepted = !!(state.accepted && state.accepted[playerIndex]);
  const pendingWho = whoUploadsNext(state);
  const mySquishyCount = (state.squishies[playerIndex] || []).length;
  const oppSquishyCount = (state.squishies[playerIndex === "p1" ? "p2" : "p1"] || []).length;

  uploadBtn.disabled = pendingWho !== "me";

  if (state.phase === "offers") {
    myTurnHint.textContent = pendingWho === "me"
      ? (mySquishyCount === 0 && oppSquishyCount === 0
          ? "🎯 It's your turn! Upload your primary squishy."
          : "🎯 Opponent made an offer! Upload your counter-offer.")
      : (mySquishyCount === 0
          ? "⏳ Waiting for your turn to upload..."
          : "⏳ Waiting for opponent's counter-offer...");
    return;
  }

  if (pendingWho === "me") {
    uploadBtn.disabled = false;
    acceptBtn.disabled = false;
    declineBtn.disabled = false;
    myTurnHint.textContent = "📤 " + opponentNameStr + " wants to add! Upload a squishy, Accept, or Decline.";
    return;
  }

  if (pendingWho === "opponent") {
    myTurnHint.textContent = "⏳ Waiting for " + opponentNameStr + " to upload an added squishy...";
    return;
  }

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
// Result overlay
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

  newTradeBtn.classList.remove("hidden");
  resultEndBtn.classList.remove("hidden");

  const mySquishiesAfter = (result.squishies && result.squishies[playerIndex]) || [];
  resultSquishies.innerHTML = "";

  const header = document.createElement("div");
  header.className = "result-sub";
  header.textContent = state.phase === "success" ? "✨ Squishies you received:" : "🔙 Squishies returned to you:";
  resultSquishies.appendChild(header);

  if (mySquishiesAfter.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "result-grid";
    mySquishiesAfter.forEach((src) => {
      const img = document.createElement("img");
      img.src = cleanUrl(src);
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

function onGameStart() {}

// ------------------------------------------------------------
// Socket events
// ------------------------------------------------------------

// Room state update
socket.on("roomState", (state) => {
  gameRoomCode.textContent = "ROOM: " + (state.code || "");

  // Fresh trade started -> close overlays.
  if (state.phase !== "success" && state.phase !== "bad" && state.phase !== "showcase") {
    hide(resultOverlay);
    hide(confirmOverlay);
    myTurnHint.textContent = "";
    newTradeBtn.classList.add("hidden");
    resultEndBtn.classList.add("hidden");
  }

  // Waiting phase -> show waiting screen.
  if (state.phase === "waiting") {
    if (waiting.classList.contains("hidden")) {
      showScreen("waiting");
      roomCodeDisplay.textContent = state.code;
    }
    return;
  }

  // Showcase phase.
  if (state.phase === "showcase") {
    hide(resultOverlay);
    hide(confirmOverlay);
    if (game.classList.contains("hidden")) showScreen("game");
    openShowcase(state);
    return;
  }

  // Show game screen.
  if (game.classList.contains("hidden")) showScreen("game");

  const oppIdx = playerIndex === "p1" ? "p2" : "p1";

  const oppPlayer = state.players.find((p) => {
    if (oppIdx === "p1") return p.isHost;
    return !p.isHost;
  });
  if (oppPlayer) {
    opponentName.textContent = (oppPlayer.name || "OPPONENT").toUpperCase();
    opponentNameStr = (oppPlayer.name || "OPPONENT").toUpperCase();
  }

  renderSquishies(mySquishies, state.squishies[playerIndex] || [], "Upload your squishy...");
  renderSquishies(opponentSquishies, state.squishies[oppIdx] || [], "Waiting for squishy...");

  const myAccepted = !!(state.accepted && state.accepted[playerIndex]);
  const oppAccepted = !!(state.accepted && state.accepted[oppIdx]);

  myStatus.textContent = myAccepted ? "Accepted" : (state.phase === "offers" ? "offering" : "waiting");
  myStatus.className = "status-pill" + (myAccepted ? " active" : " waiting");

  opponentStatus.textContent = oppAccepted ? "Accepted" : (state.phase === "offers" ? "offering" : "waiting");
  opponentStatus.className = "status-pill" + (oppAccepted ? " active" : " waiting");

  updateTradeMessage(state);
  updateActions(state);

  // If not already showing showcase, handle result.
  if (state.phase === "success" || state.phase === "bad") {
    if (state.phase === "success" || state.phase === "bad") {
      showResult(state);
    }
  }

  // Show confirm overlay if a mutual vote is pending.
  if (state.leaveVotes && (state.leaveVotes.p1 || state.leaveVotes.p2)) {
    if (confirmMode !== "end") openConfirm("leave", state);
  } else if (state.endVotes && (state.endVotes.p1 || state.endVotes.p2)) {
    openConfirm("end", state);
  } else if (confirmMode) {
    // No pending votes -> close the confirm overlay.
    hide(confirmOverlay);
    confirmMode = null;
  }

  updateConfirmVotes(state);
});

// Go home (both players agreed to leave)
socket.on("goHome", () => {
  window.location.reload();
});

// Opponent left
socket.on("opponentLeft", () => {
  myTurnHint.textContent = "❌ Opponent disconnected. Back to lobby...";
  setTimeout(() => window.location.reload(), 2000);
});

