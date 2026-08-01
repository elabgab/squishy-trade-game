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
//   phase: 'waiting' | 'offers' | 'negotiating' | 'success' | 'bad',
//   pendingAdd: 'p1' | 'p2' | null,      // who must upload the next squishy
//   accepted: { p1: bool, p2: bool },
//   originalOwners: { [imageUrl]: 'p1' | 'p2' }, // for restore on decline
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
    leaveVotes: room.leaveVotes,
    endVotes: room.endVotes,
    ratings: room.ratings,
    showcase: room.showcase,
  };
  io.to(room.code).emit("roomState", payload);
}

function resetTradeState(room) {
  room.squishies = { p1: [], p2: [] };
  room.phase = "offers";
  room.pendingAdd = null;
  room.accepted = { p1: false, p2: false };
  room.tradeResult = null;
  room.originalOwners = {};
  room.leaveVotes = { p1: false, p2: false };
  room.endVotes = { p1: false, p2: false };
  room.ratings = { p1: null, p2: null };
  room.showcase = null;
  // Start: Player 1 uploads initial offer
  emitRoomState(room);
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
      leaveVotes: { p1: false, p2: false },
      endVotes: { p1: false, p2: false },
      ratings: { p1: null, p2: null },
      showcase: null,
    };

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

  // --- Vote to leave the game -------------------------------------
  socket.on("leaveGame", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    const idx = socket.data.playerIndex;
    if (!idx) return ack && ack({ ok: false, error: "Not assigned." });

    room.leaveVotes[idx] = true;
    room.endVotes = { p1: false, p2: false }; // leaving cancels end-trade voting

    const both = room.leaveVotes.p1 && room.leaveVotes.p2;
    console.log(`[leaveGame] ${idx} voted to leave in ${code}${both ? " -> both agreed, room closed" : ""}`);

    // If both agree, close the room and tell every player to return home.
    if (both) {
      io.to(code).emit("goHome");
      // Clean up socket bindings so players can start a fresh session.
      for (const p of room.players) {
        roomBySocket.delete(p.id);
      }
      rooms.delete(code);
      ack && ack({ ok: true, home: true });
      return;
    }

    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Vote to end the trade (showcase) ---------------------------
  socket.on("endTrade", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    // Ending the trade is only meaningful after a concluded trade.
    if (room.phase !== "success" && room.phase !== "bad") {
      return ack && ack({ ok: false, error: "The trade has not concluded yet." });
    }

    const idx = socket.data.playerIndex;
    if (!idx) return ack && ack({ ok: false, error: "Not assigned." });

    room.endVotes[idx] = true;
    room.leaveVotes = { p1: false, p2: false }; // ending cancels leave voting

    const both = room.endVotes.p1 && room.endVotes.p2;
    console.log(`[endTrade] ${idx} voted to end in ${code}${both ? " -> both agreed, showcase phase" : ""}`);

    if (both) {
      room.phase = "showcase";
      room.endVotes = { p1: false, p2: false };
      room.ratings = { p1: null, p2: null };
      room.showcase = {
        screenshots: { p1: [], p2: [] },
        received: {
          // Showcase shows the squishies each player GOT from the trade.
          p1: room.tradeResult && room.tradeResult.squishies ? room.tradeResult.squishies.p1 : [],
          p2: room.tradeResult && room.tradeResult.squishies ? room.tradeResult.squishies.p2 : [],
        },
      };
    }

    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Upload a screenshot for the showcase ------------------------
  socket.on("uploadScreenshot", (imageUrl, ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "showcase") {
      return ack && ack({ ok: false, error: "Not in showcase phase." });
    }
    if (!room.showcase) {
      return ack && ack({ ok: false, error: "Showcase not ready." });
    }
    if (!imageUrl || typeof imageUrl !== "string") {
      return ack && ack({ ok: false, error: "Invalid image." });
    }

    const idx = socket.data.playerIndex;
    if (!idx) return ack && ack({ ok: false, error: "Not assigned." });

    room.showcase.screenshots[idx].push(imageUrl);
    console.log(`[uploadScreenshot] ${idx} uploaded a screenshot in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Submit a trade rating (good / bad) --------------------------
  socket.on("submitRating", (value, ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });
    if (room.phase !== "showcase") {
      return ack && ack({ ok: false, error: "Not in showcase phase." });
    }

    const idx = socket.data.playerIndex;
    if (!idx) return ack && ack({ ok: false, error: "Not assigned." });

    const rating = String(value || "").toUpperCase();
    if (rating !== "GOOD" && rating !== "BAD") {
      return ack && ack({ ok: false, error: "Rating must be GOOD or BAD." });
    }

    room.ratings[idx] = rating;
    console.log(`[submitRating] ${idx} rated ${rating} in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Cancel a vote (leave / end confirm) ------------------------
  socket.on("cancelVote", (ack) => {
    const code = getRoomForSocket(socket.id);
    if (!code) return ack && ack({ ok: false, error: "Not in a room." });
    const room = rooms.get(code);
    if (!room) return ack && ack({ ok: false, error: "Room missing." });

    const idx = socket.data.playerIndex;
    if (!idx) return ack && ack({ ok: false, error: "Not assigned." });

    if (room.leaveVotes) room.leaveVotes[idx] = false;
    if (room.endVotes) room.endVotes[idx] = false;

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

    // Only allowed after a completed/declined trade or from the showcase
    if (room.phase !== "success" && room.phase !== "bad" && room.phase !== "showcase") {
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
    room.leaveVotes = { p1: false, p2: false };
    room.endVotes = { p1: false, p2: false };
    room.ratings = { p1: null, p2: null };
    room.showcase = null;

    console.log(`[restartTrade] new trade in ${code}`);
    ack && ack({ ok: true });
    emitRoomState(room);
  });

  // --- Disconnect ----------------------------------------------------
  socket.on("disconnect", () => {
    const code = roomBySocket.get(socket.id);
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

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

