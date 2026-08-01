# 🧸 Squishy Trade Game

A real-time two-player trading game where players join a shared trading room with a unique room code, upload squishy images, and negotiate trades using **Accept**, **Add**, and **Decline**.

## Features

- 🔑 **Room codes** — Create a room and share the 6-character code with a friend
- 📤 **Squishy offers** — Player 1 uploads the first squishy, Player 2 uploads a counter-offer
- 🤝 **Negotiation** — Both players can **Accept**, **Add** (request more squishies), or **Decline**
- 🔁 **Alternating additions** — Players take turns adding one squishy at a time
- 🎉 **Trade Successful** — Both players Accept → ownership of all squishies is exchanged
- 💔 **Trade Unsuccessful (Bad Trade)** — Any player Declines → all squishies are restored to their original owners and the interface resets for a new trade

## Tech Stack

- **Node.js** + **Express** — static server
- **Socket.IO** — real-time WebSocket communication

## How to Run

### 1. Install Node.js
Download and install Node.js from [https://nodejs.org](https://nodejs.org) (LTS version recommended).

### 2. Install dependencies
Open a terminal in the project folder:

```bash
npm install
```

### 3. Start the server

```bash
npm start
```

### 4. Play
Open your browser and go to **http://localhost:3000**

- Player 1: click **CREATE ROOM**, share the room code
- Player 2: on another device/browser (same Wi-Fi network), open `http://<your-ip>:3000` and enter the code, then click **JOIN**

> To play with a friend over the internet, you can deploy this to a free hosting service like Render, Railway, or Glitch, or use a tunnel tool like `ngrok`.

## Deploy to Render (Free)

This project is ready to deploy on [Render](https://render.com) using the included [`render.yaml`](render.yaml) blueprint.

### Option A — Deploy via Blueprint (render.yaml)
1. Push this repo to **GitHub**.
2. Log in to [Render.com](https://render.com) and click **New + → Blueprint**.
3. Connect your GitHub repo and select it.
4. Render reads `render.yaml`, creates the web service automatically, and starts it.
5. Once live, share the `https://<your-app>.onrender.com` URL with your friend.

### Option B — Deploy via Web Service (Manual)
1. Push this repo to **GitHub**.
2. Log in to Render → **New + → Web Service**.
3. Connect your GitHub repo.
4. Use these settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **Create Web Service**. Render will assign a free URL like `https://squishy-trade-game.onrender.com`.

### Important Notes for Render
- **Port**: The server uses `process.env.PORT` automatically (Render injects it).
- **Health check**: A `/healthz` endpoint is included so Render knows your app is up.
- **Free tier sleeps**: On Render's free tier, services spin down after ~15 minutes of inactivity. The first request after a sleep may take ~30–60 seconds to wake up.
- **In-memory rooms**: Rooms and trades are stored in memory, so they reset if the server restarts. This is fine for casual play. (Socket.IO with multiple instances would require a Redis adapter — not needed for the free single-instance setup.)

## Project Structure

```
squishy-trade-game/
├── server.js          # Express + Socket.IO server (rooms, trade state machine)
├── package.json
├── public/
│   ├── index.html     # Lobby, Waiting, Game, and Result screens
│   ├── style.css      # Kawaii squishy theme
│   └── game.js        # Client game logic
```

## Game Flow

1. **Lobby** → create or join a room with a code
2. **Waiting** → Player 1 waits for Player 2 to connect
3. **Offers** → Player 1 uploads a squishy, Player 2 uploads a counter-offer
4. **Negotiating** → both players use Accept / Add / Decline
   - **Accept** → lock in your agreement (both must accept)
   - **Add** → ask the other player to upload another squishy
   - **Decline** → end the trade as a Bad Trade
5. **Result** → Trade Successful (ownership swapped) or Trade Unsuccessful (items restored) + start a new trade

## License

MIT

