# DoodleDoom ⚔️ — AI Drawing Arena

A real-time, multiplayer drawing auto-battler powered by **Google Gemini** and the **Model Context Protocol (MCP)**. Draw your warrior, let AI evaluate it, and watch them fight!

Built for the **Kaggle AI Agents: Intensive Vibe Coding Capstone**.

## Architecture

```
┌─────────────┐     Socket.io     ┌──────────────────┐     stdio/MCP     ┌─────────────────────┐
│   React UI  │ ◄──────────────► │  Express Backend  │ ◄──────────────► │  MCP Battle Engine  │
│  (Vite)     │                   │  (Gemini Vision)  │                   │  (Gemini Narrator)  │
└─────────────┘                   └──────────────────┘                   └─────────────────────┘
```

## Quick Start

```bash
# 1. Clone and install
git clone <your-repo-url>
cd capstone

# 2. Set your API key
echo "GEMINI_API_KEY=your_key_here" > backend/.env

# 3. Install dependencies
cd backend && npm install
cd ../mcp-battle-engine && npm install
cd ../frontend && npm install

# 4. Start the backend (also starts MCP engine)
cd ../backend && npm start

# 5. Start the frontend (in a new terminal)
cd ../frontend && npm run dev
```

Open **two browser tabs** at `http://localhost:5173` and play!

## Features

- 🎨 **Canvas Drawing** — Draw your warrior on an HTML5 Canvas
- 🤖 **Vision Agent** — Gemini evaluates your sketch and generates balanced RPG stats
- ⚔️ **AI Battle Engine** — A decoupled MCP server narrates a cinematic auto-battle
- 🏆 **Multi-Round Scoring** — Persistent score tracking across rounds
- 🔄 **Session Recovery** — Reconnect seamlessly after disconnects
- 🛡️ **Rate Limiting** — Express middleware protects the AI endpoint
- 🎤 **Live Commentary** — Turn-by-turn battle narration with player taunts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | Express + Socket.io |
| AI Vision | Google Gemini 2.5 Flash |
| Battle Engine | MCP Server + Gemini |
| Protocol | Model Context Protocol (stdio) |
