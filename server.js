const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Allow larger payloads (squishy images sent as data URLs over Socket.IO)
const io = new Server(server, {
  maxHttpBufferSize: 8 * 1024 * 1024, // 8 MB
});

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Static files + health check (Render uses this to confirm the app is up)
// ------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

// ------------------------------------------------------------
// In-memory room store
// ------------------------------------------------------------
// room: {
//   code: string,
//   players: [{ id, name }],
//   squishies: { p1: [imageUrl], p2: [imageUrl] },
//   phase: 'waiting' | 'offers' | 'negotiating' | 'endproof' | 'endrated' | 'success' | 'bad',
//   pendingAdd: 'p1' | 'p2' | null,      // who must upload the next squishy
//   accepted: { p1: bool, p2: bool },
//   originalOwners: { [imageUrl]: 'p1' | 'p2' }, // for restore on decline
//   endRequestedBy: 'p1' | 'p2' | null,   // who initiated the end-trade request
//   endVotes: { p1: bool, p2: bool },     // mutual agreement to end the trade
//   endProofs: { p1: [imageUrl], p2: [imageUrl] }, // screenshot proof of received squishy
//   ratings: { p1: number|null, p2: number|null }, // 0-10 slider rating (submitted)
//   ratingPreviews: { p1: number|null, p2: number|null }, // live slider preview shared with opponent
//   endResult: { status, ... } | null,    // final end-trade verdict
// }
const rooms = new Map();
const roomBySocket = new Map();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Avoid collisions
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function getRoomForSocket(socketId) {
  return roomBySocket.get(socketId) || null;
}

function emitRoomState(room) {
  const players = room.players;
  const payload = {
    code: room.code,
    phase: room.phase,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostId,
    })),
    squishies: room.squishies,
    pendingAdd: room.pendingAdd,
    accepted: room.accepted,
    addRequestedBy: room.addRequestedBy || null,
    tradeResult: room.tradeResult || null,
    // End-trade data
    endRequestedBy: room.endRequestedBy || null,
    endVotes: room.endVotes,
    endProofs: room.endProofs,
    ratings: room.ratings,
    ratingPreviews: room.ratingPreviews || { p1: null, p2: null },
    endResult: room.endResult || null,
  };
  io.to(room.code).emit("roomState", payload);
}

// Initialize the end-trade fields on a fresh room / restart.
function initEndTradeFields(room) {
  room.endRequestedBy = null;
  room.endVotes = { p1: false, p2: false };
  room.endProofs = { p1: [], p2: [] };
  room.ratings = { p1: null, p2: null };
  room.ratingPreviews = { p1: null, p2: null };
  room.endResult = null;
  room.autoCloseTimer = null;
}

function resetTradeState(room) {
  room.squishies = { p1: [], p2: [] };
  room.phase = "offers";
  room.pendingAdd = null;
  room.accepted = { p1: false, p2: false };
  room.tradeResult = null;
  room.originalOwners = {};
  // Start: Player 1 uploads initial offer
  emitRoomState(room);
}

// Close a room for everyone: notify all players, clean up socket
// bindings, and delete the room from memory. Any pending auto-close
// timer is cancelled so we don't try to close a room twice.
function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.autoCloseTimer) {
    clearTimeout(room.autoCloseTimer);
    room.autoCloseTimer = null;
  }
  io.to(code).emit("roomClosed");
  for (const p of room.players) {
    roomBySocket.delete(p.id);
    const s = io.sockets.sockets.get(p.id);
    if (s) s.leave(code);
  }
  rooms.delete(code);
}

// ------------------------------------------------------------
// Socket handlers
// ------------------------------------------------------------
io.on("connection", (socket) => {
  console.log(`[+] socket connected: ${socket.id}`);

  // --- Create room -------------------------------------------------
  socket.on("createRoom", (playerName, ack) => {
    const name = (playerName || "Player").toString().slice(0, 20);
    if (roomBySocket.has(socket.id)) {
      ack && ack({ ok: false, error: "You are already in a room." });
      return;
    }

    const code = generateRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name }],
      squishies: { p1: [], p2: [] },
      phase: "waiting", // waiting for a second player
      pendingAdd: null,
      accepted: { p1: false, p2: false },
      tradeResult: null,
      originalOwners: {},
    };
    initEndTradeFields(room);

    rooms.set(code, room);
    roomBySocket.set(socket.id, code);
    socket.join(code);
    socket.data.playerIndex = "p1";

    console.log(`[createRoom] ${code} hosted by ${name}`);
    ack && ack({ ok: true, code, playerIndex: "p1" });
    emitRoomState(room);
  });

  // --- Join room ---------------------------------------------------
  socket.on("joinRoom", (payload, ack) => {
    const { code: rawCode, playerName } = payload || {};
    const code = (rawCode || "").toString().trim().toUpperCase();
    const name = (playerName || "Player").toString().slice(0, 20);

    if (!code) {
      ack && ack({ ok: false, error: "Please enter a room code." });
      return;
    }
    if (roomBySocket.has(socket.id)) {
      ack && ack({ ok: false, error: "You are already in a room." });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      ack && ack({ ok: false, error: "Room not found. Check the code." });
      return;
    }
    if (room.players.length >= 2) {
      ack && ack({ ok: false, error: "Room is already full." });
      return;
    }
    if (room.phase !== "waiting") {
      ack && ack({ ok: false, error: "Trade already in progress." });
      return;
    }

    room.players.push({ id: socket.id, name });
    roomBySocket.set(socket.id, code);
    socket.join(code);
    socket.data.playerIndex = "p2";

    // Both players connected => start the trade.
    // Per the game spec, Player 1 initiates by uploading the first squishy.
    room.phase = "offers";
    room.pendingAdd = "p1";
    console.log(`[joinRoom] ${name} joined ${code}`);

    ack && ack({ ok: true, code, playerIndex: "p2" });
    emitRoomState(room);
  });

  // --- Upload a squishy (initial offer or addition) ----------------
  socket.on("uploadOffer", (imageUrl, ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    const idx = socket.data.playerIndex; // 'p1' | 'p2'
    if (!idx) return ack && ack({ ok: false, error: "Not assigned." });

    // Must be their turn to upload
    if (room.pendingAdd !== idx) {
      ack && ack({ ok: false, error: "It is not your turn to upload." });
      return;
    }

    if (!imageUrl || typeof imageUrl !== "string") {
      ack && ack({ ok: false, error: "Invalid image." });
      return;
    }

    room.squishies[idx].push(imageUrl);
    room.originalOwners[imageUrl] = idx;

    // Advance the turn
    if (room.phase === "offers") {
      // Both initial offers in?
      if (room.squishies.p1.length > 0 && room.squishies.p2.length > 0) {
        room.phase = "negotiating";
        room.pendingAdd = null;
        room.accepted = { p1: false, p2: false };
      } else {
        // One offer submitted — hand off to the OTHER player so they can
        // make the counter-offer (works regardless of who was randomly
        // selected to upload first).
        room.pendingAdd = idx === "p1" ? "p2" : "p1";
      }
    } else if (room.phase === "negotiating") {
      // After an addition, back to the other player
      const other = idx === "p1" ? "p2" : "p1";
      room.pendingAdd = other;
      room.accepted = { p1: false, p2: false }; // Adding resets accept flags
      room.addRequestedBy = null; // clear the pending add request
    }

    console.log(`[uploadOffer] ${idx} uploaded in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Add request (ask opponent to upload another squishy) ---------
  socket.on("addRequest", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "negotiating") {
      return ack && ack({ ok: false, error: "Not in negotiation phase." });
    }

    const idx = socket.data.playerIndex;
    const other = idx === "p1" ? "p2" : "p1";
    if (room.pendingAdd !== null) {
      return ack && ack({ ok: false, error: "The other player is already uploading." });
    }
    if (room.accepted[idx]) {
      return ack && ack({ ok: false, error: "You have accepted the trade. Cancel your accept first." });
    }

    // Set the other player as the one who must upload next
    room.pendingAdd = other;
    room.accepted = { p1: false, p2: false };
    room.addRequestedBy = idx;

    console.log(`[addRequest] ${idx} requested addition from ${other} in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Accept trade ------------------------------------------------
  socket.on("acceptTrade", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "negotiating") {
      return ack && ack({ ok: false, error: "Not in negotiation phase." });
    }

    const idx = socket.data.playerIndex;

    // If there is a pending Add request, accepting now means you are happy
    // with the trade as-is — the pending add request is effectively cancelled.
    if (room.pendingAdd !== null || room.addRequestedBy !== null) {
      room.pendingAdd = null;
      room.addRequestedBy = null;
    }
    if (room.squishies.p1.length === 0 || room.squishies.p2.length === 0) {
      return ack && ack({ ok: false, error: "Both players need to offer at least one squishy." });
    }

    room.accepted[idx] = true;

    // If both accepted => trade successful + swap ownership
    if (room.accepted.p1 && room.accepted.p2) {
      room.phase = "success";
      room.addRequestedBy = null;
      initEndTradeFields(room);
      room.tradeResult = {
        status: "success",
        message: "Trade Successful! Ownership exchanged.",
        squishies: {
          // After exchange, p1 receives p2's squishies and vice versa
          p1: [...room.squishies.p2],
          p2: [...room.squishies.p1],
        },
      };
      console.log(`[trade] SUCCESS in ${code}`);
    } else {
      room.pendingAdd = null;
      console.log(`[acceptTrade] ${idx} accepted in ${code}`);
    }
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Decline trade -----------------------------------------------
  socket.on("declineTrade", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    // Can decline during offers or negotiating
    if (room.phase !== "negotiating" && room.phase !== "offers") {
      return ack && ack({ ok: false, error: "Cannot decline at this stage." });
    }

    const idx = socket.data.playerIndex;
    room.phase = "bad";
    room.addRequestedBy = null;
    room.tradeResult = {
      status: "bad",
      message: "Trade Unsuccessful (Bad Trade).",
      declinedBy: idx,
      squishies: {
        // Restore original owners
        p1: room.squishies.p1.filter((u) => room.originalOwners[u] === "p1"),
        p2: room.squishies.p2.filter((u) => room.originalOwners[u] === "p2"),
      },
    };

    console.log(`[declineTrade] ${idx} declined in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Restart trade (new trading session) --------------------------
  socket.on("restartTrade", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    // Only allowed after a completed/declined/rated trade
    if (room.phase !== "success" && room.phase !== "bad" && room.phase !== "endrated") {
      return ack && ack({ ok: false, error: "No finished trade to restart." });
    }

    room.squishies = { p1: [], p2: [] };
    room.phase = "offers";
    // Player 1 initiates the new trading session
    room.pendingAdd = "p1";
    room.accepted = { p1: false, p2: false };
    room.tradeResult = null;
    room.originalOwners = {};
    room.addRequestedBy = null;
    initEndTradeFields(room);

    console.log(`[restartTrade] new trade in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- End trade (request to end; mutual agreement required) ---------
  socket.on("endTrade", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    // Allowed during the offers or negotiating phase — End Trade is meant for
    // when both players have nothing left to trade, so it does not require an
    // active negotiation to be in progress.
    if (room.phase !== "offers" && room.phase !== "negotiating") {
      return ack && ack({ ok: false, error: "You can only end the trade while trading." });
    }

    const idx = socket.data.playerIndex;
    const other = idx === "p1" ? "p2" : "p1";

    // First vote: record who requested the end.
    if (!room.endVotes.p1 && !room.endVotes.p2) {
      room.endRequestedBy = idx;
      room.endVotes[idx] = true;
      console.log(`[endTrade] ${idx} requested to end trade in ${code}`);
      ack && ack({ ok: true });
      emitRoomState(room);
      return;
    }

    // Already voted by me -> ignore duplicate.
    if (room.endVotes[idx]) {
      return ack && ack({ ok: false, error: "You already agreed to end the trade." });
    }

    // Second vote: both agree -> move to endproof phase.
    room.endVotes[idx] = true;
    room.endRequestedBy = room.endRequestedBy || other;
    room.phase = "endproof";
    room.pendingAdd = null;
    room.accepted = { p1: false, p2: false };
    room.addRequestedBy = null;
    room.ratings = { p1: null, p2: null };
    room.ratingPreviews = { p1: null, p2: null };
    room.endProofs = { p1: [], p2: [] };

    console.log(`[endTrade] BOTH agreed in ${code} -> endproof.`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Cancel the end-trade request (first voter backs out) ----------
  socket.on("endTradeCancel", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "offers" && room.phase !== "negotiating") {
      return ack && ack({ ok: false, error: "Not in a trade to cancel." });
    }

    const idx = socket.data.playerIndex;
    // Anyone in the room can dismiss the pending end request
    // voted to end or simply disagree with the other player's request.
    // Reset the votes so a future end request starts fresh.
    room.endVotes = { p1: false, p2: false };
    room.endRequestedBy = null;
    room.endProofs = { p1: [], p2: [] };
    room.ratings = { p1: null, p2: null };
    room.ratingPreviews = { p1: null, p2: null };
    room.endResult = null;

    console.log(`[endTradeCancel] ${idx} cancelled end request in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Upload end-proof screenshot ------------------------------------
  socket.on("uploadEndProof", (imageUrl, ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "endproof") {
      return ack && ack({ ok: false, error: "Not in end-proof phase." });
    }

    const idx = socket.data.playerIndex;
    if (!imageUrl || typeof imageUrl !== "string") {
      return ack && ack({ ok: false, error: "Invalid screenshot." });
    }

    room.endProofs[idx].push(imageUrl);
    console.log(`[uploadEndProof] ${idx} uploaded proof in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Live rating preview (shared with the opponent as the slider moves) ---
  socket.on("previewRating", (rating) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.phase !== "endproof") return;

    const idx = socket.data.playerIndex;
    const val = Math.max(0, Math.min(10, Math.round(Number(rating) || 0)));
    room.ratingPreviews[idx] = val;
    emitRoomState(room);
  });

  // --- Submit rating (finalizes the end-trade result) -----------------
  socket.on("submitRating", (rating, ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "endproof") {
      return ack && ack({ ok: false, error: "Not in end-proof phase." });
    }

    const idx = socket.data.playerIndex;
    const val = Math.max(0, Math.min(10, Math.round(Number(rating) || 0)));
    room.ratings[idx] = val;

    // Both rated -> finalize: exchange ownership and build verdict.
    if (room.ratings.p1 !== null && room.ratings.p2 !== null) {
      room.phase = "endrated";
      const avg = (room.ratings.p1 + room.ratings.p2) / 2;
      const status = avg >= 5 ? "good" : "bad";
      room.endResult = {
        status,
        avgRating: avg,
        ratings: { p1: room.ratings.p1, p2: room.ratings.p2 },
        // Ownership exchanged (like accept).
        squishies: {
          p1: [...room.squishies.p2],
          p2: [...room.squishies.p1],
        },
        endProofs: {
          p1: [...room.endProofs.p1],
          p2: [...room.endProofs.p2],
        },
      };
      room.tradeResult = {
        status: status === "good" ? "success" : "bad",
        message: status === "good"
          ? "Trade Successful! Ownership exchanged."
          : "Trade ended and rated as a bad trade.",
        squishies: room.endResult.squishies,
      };
      console.log(`[submitRating] ${idx} rated ${val} in ${code}. End result: ${status}.`);

      // BOTH players have submitted ratings now — close the room for
      // everyone shortly after, so both players get to see the final
      // result before being returned to the lobby.
      if (room.autoCloseTimer) clearTimeout(room.autoCloseTimer);
      room.autoCloseTimer = setTimeout(() => {
        closeRoom(code);
      }, 4000);
    } else {
      console.log(`[submitRating] ${idx} rated ${val} in ${code}. Waiting for other.`);
    }
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Leave room (close the room for everyone) ----------------------
  socket.on("leaveRoom", (ack) => {
    const code = roomBySocket.get(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    // Tell everyone in the room (including the leaver) that it is closing,
    // so every player returns to the lobby automatically.
    closeRoom(code);

    console.log(`[leaveRoom] ${socket.id} closed room ${code} for everyone.`);
    ack && ack({ ok: true });
  });

  // --- Disconnect ----------------------------------------------------
  socket.on("disconnect", () => {
    const code = roomBySocket.get(socket.id);
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    // Cancel any pending auto-close so a stale timer doesn't fire later.
    if (room.autoCloseTimer) {
      clearTimeout(room.autoCloseTimer);
      room.autoCloseTimer = null;
    }

    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx !== -1) room.players.splice(idx, 1);

    roomBySocket.delete(socket.id);

    if (room.players.length === 0) {
      rooms.delete(code);
      console.log(`[disconnect] room ${code} closed (empty).`);
      return;
    }

    // Remaining player is now alone
    room.phase = "waiting";
    room.squishies = { p1: [], p2: [] };
    room.pendingAdd = null;
    room.accepted = { p1: false, p2: false };
    room.tradeResult = null;
    room.originalOwners = {};
    room.addRequestedBy = null;
    initEndTradeFields(room);

    // If host left, promote the remaining player
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }
    // Remaining player becomes p1 again (they will initiate the next trade)
    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.data.playerIndex = "p1";
    }

    console.log(`[disconnect] ${socket.id} left ${code}, back to waiting.`);
    io.to(code).emit("opponentLeft");
    // Reset state for whoever remains
    emitRoomState(room);
  });
});

// ------------------------------------------------------------
// Start server
// ------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`\n  🧸 Squishy Trade Game server running!`);
  console.log(`  ➜  Local:   http://localhost:${PORT}`);
  console.log(`  ➜  Network: http://<your-ip>:${PORT}  (for other devices)\n`);
});

