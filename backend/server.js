import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { RoomManager } from './RoomManager.js';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

// MCP Client Imports
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────
// Express & Socket.io Setup
// ─────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate Limiting — protects the REST API from abuse
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again later." }
});
app.use('/api/', apiLimiter);

// Health check endpoint for deployment monitoring
app.get('/health', (req, res) => {
    res.json({ status: 'ok', mcpConnected: !!mcpClient, uptime: process.uptime() });
});

// ─────────────────────────────────────────────────────
// Gemini Vision Agent Configuration
// ─────────────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL: GEMINI_API_KEY is not set in .env");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const systemInstruction = `You are the DoodleDoom Vision Agent. Your task is to evaluate a drawing and generate balanced stats for an auto-battler game.
The drawing will be based on a specific prompt.

You MUST return a pure JSON object containing EXACTLY the following structure:
{
  "matchScore": <number between 0-100 indicating how well the drawing matches the prompt>,
  "visualDescription": "<A highly detailed, vibrant, one-sentence physical description of what this cartoon warrior looks like based on the drawing>",
  "stats": {
    "hp": <number between 50-200>,
    "attack": <number between 10-50>,
    "defense": <number between 5-40>,
    "speed": <number between 10-100>
  },
  "specialSkill": {
    "name": "<Creative skill name based on drawing>",
    "description": "<What it does in the battle context>"
  },
  "reasoning": "<A brief one-sentence explanation of why these stats were chosen based on visual features>"
}

Rules for balancing:
- Higher 'matchScore' should generally yield slightly better total stats.
- Distribute stats based on visuals: e.g., spiky/sharp elements -> higher attack; bulky/round -> higher defense/hp; streamlined/wheels -> higher speed.
- Do NOT wrap the JSON in markdown code blocks, return ONLY raw JSON.`;

const safetySettings = [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' }
];

// ─────────────────────────────────────────────────────
// MCP Client for Battle Engine
// ─────────────────────────────────────────────────────
let mcpClient = null;
let mcpTransport = null;

async function setupMcpClient() {
    mcpTransport = new StdioClientTransport({
        command: "node",
        args: [path.join(__dirname, "../mcp-battle-engine/index.js")],
    });

    mcpClient = new Client(
        { name: "doodledoom-backend", version: "1.0.0" },
        { capabilities: {} }
    );

    await mcpClient.connect(mcpTransport);
    console.log("✅ Connected to MCP Battle Engine");
}
setupMcpClient().catch((err) => {
    console.error("❌ Failed to connect to MCP Battle Engine:", err.message);
});

// ─────────────────────────────────────────────────────
// Helper: Broadcast sanitized room state
// ─────────────────────────────────────────────────────
function broadcastRoomState(roomId) {
    const room = RoomManager.getRoom(roomId);
    if (room) {
        io.to(roomId).emit('roomStateUpdate', RoomManager.sanitizeRoom(room));
    }
}

// ─────────────────────────────────────────────────────
// Helper: Evaluate drawing with retry + fallback
// ─────────────────────────────────────────────────────
async function evaluateDrawing(base64Data, prompt) {
    let result = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { text: `Evaluate this drawing for the prompt: "${prompt}"` },
                        { inlineData: { data: base64Data, mimeType: "image/png" } }
                    ]
                }],
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    safetySettings
                }
            });
            result = JSON.parse(response.text);
            break;
        } catch (err) {
            console.error(`Vision Agent attempt ${attempt}/3 failed:`, err.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (!result) {
        // Fallback "glitch" stats so the game never gets stuck
        result = {
            matchScore: 0,
            visualDescription: "A glitched anomaly — the Vision Agent could not decode this creation.",
            stats: { hp: 50, attack: 10, defense: 10, speed: 10 },
            specialSkill: { name: 'System Crash', description: 'An unpredictable glitch in the matrix.' },
            reasoning: 'The Vision Agent failed to process the image after 3 attempts.'
        };
    }
    return result;
}

// ─────────────────────────────────────────────────────
// Socket Rate Limiting (per-session, in-memory)
// ─────────────────────────────────────────────────────
const socketRateLimits = new Map();
function checkSocketRateLimit(sessionId) {
    const now = Date.now();
    const lastCalled = socketRateLimits.get(sessionId) || 0;
    if (now - lastCalled < 2000) return false;
    socketRateLimits.set(sessionId, now);
    return true;
}

// ─────────────────────────────────────────────────────
// Socket.io Event Handlers
// ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // ── JOIN ROOM ──
    socket.on('joinRoom', ({ roomId, sessionId, playerName }) => {
        // Input validation
        if (!roomId || typeof roomId !== 'string' || roomId.length > 20) return;
        if (!sessionId || typeof sessionId !== 'string') return;
        if (!playerName || typeof playerName !== 'string') return;

        const sanitizedName = playerName.trim().substring(0, 20);
        if (!sanitizedName) return;

        const room = RoomManager.getRoom(roomId);
        // Prevent joining mid-game (unless reconnecting)
        if (room && room.state !== 'LOBBY' && !room.players[sessionId]) {
            socket.emit('battleError', 'Game is already in progress. Cannot join.');
            return;
        }

        socket.join(roomId);
        socket.sessionId = sessionId;
        socket.currentRoomId = roomId;

        RoomManager.addPlayer(roomId, sessionId, socket.id, sanitizedName);
        broadcastRoomState(roomId);
    });

    // ── TOGGLE READY ──
    socket.on('toggleReady', ({ roomId, isReady }) => {
        if (!socket.sessionId || !roomId) return;
        const room = RoomManager.getRoom(roomId);
        if (!room || room.state !== 'LOBBY') return;

        RoomManager.setPlayerReady(roomId, socket.sessionId, isReady);
        broadcastRoomState(roomId);

        if (RoomManager.areAllPlayersReady(roomId)) {
            room.state = 'DRAWING';
            room.timeRemaining = 60;
            broadcastRoomState(roomId);

            room.timerInterval = setInterval(() => {
                room.timeRemaining -= 1;
                io.to(roomId).emit('timerUpdate', room.timeRemaining);

                if (room.timeRemaining <= 0) {
                    clearInterval(room.timerInterval);
                    room.timerInterval = null;
                    room.state = 'EVALUATING';
                    broadcastRoomState(roomId);
                    io.to(roomId).emit('timesUp_submitDrawing');
                }
            }, 1000);
        }
    });

    // ── SUBMIT DRAWING ──
    socket.on('submitDrawing', async ({ roomId, imageBase64 }) => {
        if (!socket.sessionId || !roomId) return;
        const room = RoomManager.getRoom(roomId);
        if (!room) return;

        if (!checkSocketRateLimit(socket.sessionId)) {
            socket.emit('battleError', 'Rate limit exceeded. Please wait.');
            return;
        }

        if (!imageBase64 || typeof imageBase64 !== 'string') return;

        RoomManager.setPlayerDrawing(roomId, socket.sessionId, imageBase64);

        try {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            const jsonResult = await evaluateDrawing(base64Data, room.prompt);

            if (jsonResult.matchScore === 0 && jsonResult.stats.hp === 50) {
                socket.emit('battleError', 'Warning: AI Evaluation failed after 3 attempts. You have been assigned Glitch Stats!');
            }

            RoomManager.setPlayerStats(roomId, socket.sessionId, jsonResult);
            io.to(roomId).emit('playerEvaluated', { sessionId: socket.sessionId, stats: jsonResult });

            // Check if all connected players have been evaluated
            const connectedPlayers = Object.values(room.players).filter(p => p.connected);
            const allEvaluated = connectedPlayers.every(p => p.stats !== null);

            if (allEvaluated && room.state === 'EVALUATING') {
                room.state = 'BATTLING';
                broadcastRoomState(roomId);

                if (mcpClient) {
                    try {
                        const battlePlayers = connectedPlayers.map(p => ({
                            id: p.id,
                            name: p.name,
                            stats: {
                                hp: p.stats.stats.hp,
                                attack: p.stats.stats.attack,
                                defense: p.stats.stats.defense,
                                speed: p.stats.stats.speed
                            },
                            specialSkill: p.stats.specialSkill
                        }));

                        const mcpResponse = await mcpClient.callTool({
                            name: "simulate_battle",
                            arguments: { players: battlePlayers }
                        });
                        const battleLog = JSON.parse(mcpResponse.content[0].text);

                        // Parse winner and increment score
                        const gameOverEvent = battleLog.find(e => e.type === 'game_over');
                        if (gameOverEvent?.winnerId) {
                            RoomManager.incrementScore(roomId, gameOverEvent.winnerId);
                        }

                        io.to(roomId).emit('battleLog', battleLog);
                        broadcastRoomState(roomId); // Sends updated scores
                    } catch (mcpError) {
                        console.error("MCP Battle Engine failed:", mcpError.message);
                        io.to(roomId).emit('battleError', "Failed to simulate battle. The Battle Engine may be overloaded.");
                    }
                } else {
                    io.to(roomId).emit('battleError', "Battle Engine is not connected. Please restart the server.");
                }
            }
        } catch (error) {
            console.error('Unexpected error in submitDrawing:', error);
            socket.emit('battleError', 'An unexpected error occurred during evaluation.');
        }
    });

    // ── NEXT ROUND ──
    socket.on('startNextRound', ({ roomId }) => {
        if (!socket.sessionId || !roomId) return;
        const room = RoomManager.getRoom(roomId);
        if (!room || room.state !== 'BATTLING') return;

        RoomManager.resetRoomForNextRound(roomId);
        broadcastRoomState(roomId);
    });

    // ── LEAVE ROOM ──
    socket.on('leaveRoom', () => {
        if (socket.currentRoomId) {
            const room = RoomManager.disconnectPlayer(socket.currentRoomId, socket.id);
            if (room) {
                broadcastRoomState(socket.currentRoomId);
            }
            socket.leave(socket.currentRoomId);
            socket.currentRoomId = null;
        }
    });

    // ── DISCONNECT ──
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (socket.currentRoomId) {
            const room = RoomManager.disconnectPlayer(socket.currentRoomId, socket.id);
            if (room) {
                broadcastRoomState(socket.currentRoomId);
            }
        }
    });
});

// ─────────────────────────────────────────────────────
// REST API (standalone evaluation — useful for testing)
// ─────────────────────────────────────────────────────
app.post('/api/evaluate-drawing', async (req, res) => {
    try {
        const { imageBase64, prompt } = req.body;
        if (!imageBase64 || !prompt) {
            return res.status(400).json({ error: 'Missing imageBase64 or prompt' });
        }
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const result = await evaluateDrawing(base64Data, prompt);
        res.json(result);
    } catch (error) {
        console.error('REST evaluation error:', error);
        res.status(500).json({ error: 'Failed to evaluate drawing.' });
    }
});

// ─────────────────────────────────────────────────────
// Serve React Frontend (Production)
// ─────────────────────────────────────────────────────
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendDistPath, 'index.html'));
    }
});

// ─────────────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────────────
async function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    if (mcpClient) {
        try { await mcpClient.close(); } catch (e) { /* ignore */ }
    }
    httpServer.close(() => {
        console.log("Server closed.");
        process.exit(0);
    });
    // Force exit after 5s if something hangs
    setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────
httpServer.listen(port, () => {
    console.log(`🎮 DoodleDoom backend running on http://localhost:${port}`);
});
