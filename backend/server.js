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

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate Limiting for the REST API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
});
app.use('/api/', apiLimiter);

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

// -----------------------------------------------------
// Setup MCP Client for Battle Engine
// -----------------------------------------------------
let mcpClient = null;

async function setupMcpClient() {
    const transport = new StdioClientTransport({
        command: "node",
        args: [path.join(__dirname, "../mcp-battle-engine/index.js")],
    });

    mcpClient = new Client(
        { name: "doodledoom-backend", version: "1.0.0" },
        { capabilities: {} }
    );

    await mcpClient.connect(transport);
    console.log("Connected to MCP Battle Engine");
}
setupMcpClient().catch(console.error);

// -----------------------------------------------------
// Socket.io Real-Time Mechanics
// -----------------------------------------------------

// Socket Rate Limiting mechanism (simple in-memory token bucket or Map)
const socketRateLimits = new Map();
function checkSocketRateLimit(sessionId) {
    const now = Date.now();
    const lastCalled = socketRateLimits.get(sessionId) || 0;
    if (now - lastCalled < 2000) { // Limit to 1 evaluation per 2 seconds per session
        return false;
    }
    socketRateLimits.set(sessionId, now);
    return true;
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, sessionId, playerName }) => {
        socket.join(roomId);
        // Map this socket to the session
        socket.sessionId = sessionId;
        
        RoomManager.addPlayer(roomId, sessionId, socket.id, playerName);
        io.to(roomId).emit('roomStateUpdate', RoomManager.getRoom(roomId));
    });

    socket.on('toggleReady', ({ roomId, isReady }) => {
        if (!socket.sessionId) return;
        RoomManager.setPlayerReady(roomId, socket.sessionId, isReady);
        const room = RoomManager.getRoom(roomId);
        io.to(roomId).emit('roomStateUpdate', room);

        if (room.state === 'LOBBY' && RoomManager.areAllPlayersReady(roomId)) {
            room.state = 'DRAWING';
            room.timeRemaining = 60; // Increased to 60 seconds for more drawing time
            io.to(roomId).emit('roomStateUpdate', room);
            
            room.timerInterval = setInterval(() => {
                room.timeRemaining -= 1;
                io.to(roomId).emit('timerUpdate', room.timeRemaining);

                if (room.timeRemaining <= 0) {
                    clearInterval(room.timerInterval);
                    room.state = 'EVALUATING';
                    io.to(roomId).emit('roomStateUpdate', room);
                    io.to(roomId).emit('timesUp_submitDrawing');
                }
            }, 1000);
        }
    });

    socket.on('submitDrawing', async ({ roomId, imageBase64 }) => {
        if (!socket.sessionId) return;
        
        if (!checkSocketRateLimit(socket.sessionId)) {
            socket.emit('battleError', 'Rate limit exceeded. Please wait.');
            return;
        }

        RoomManager.setPlayerDrawing(roomId, socket.sessionId, imageBase64);
        const room = RoomManager.getRoom(roomId);
        
        try {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: `Evaluate this drawing for the prompt: "${room.prompt}"` },
                            { inlineData: { data: base64Data, mimeType: "image/png" } }
                        ]
                    }
                ],
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' }
                    ]
                }
            });

            const jsonResult = JSON.parse(response.text);
            RoomManager.setPlayerStats(roomId, socket.sessionId, jsonResult);
            
            io.to(roomId).emit('playerEvaluated', { sessionId: socket.sessionId, stats: jsonResult });

            // Check if all connected players in room are evaluated
            const connectedPlayers = Object.values(room.players).filter(p => p.connected);
            const allEvaluated = connectedPlayers.every(p => p.stats !== null);
            
            if (allEvaluated && room.state === 'EVALUATING') {
                room.state = 'BATTLING';
                io.to(roomId).emit('roomStateUpdate', room);
                
                if (mcpClient) {
                    try {
                        const mcpResponse = await mcpClient.callTool({
                            name: "simulate_battle",
                            arguments: {
                                players: connectedPlayers
                            }
                        });
                        const battleLogText = mcpResponse.content[0].text;
                        const battleLog = JSON.parse(battleLogText);
                        io.to(roomId).emit('battleLog', battleLog);
                    } catch (mcpError) {
                        console.error("MCP Battle Engine failed:", mcpError);
                        io.to(roomId).emit('battleError', "Failed to simulate battle.");
                    }
                }
            }
        } catch (error) {
            console.error('Error evaluating drawing:', error);
            socket.emit('battleError', 'Error evaluating drawing. Gemini might be busy.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        // Remove socket from all its rooms, and mark the player as disconnected
        socket.rooms.forEach(roomId => {
             const room = RoomManager.disconnectPlayer(roomId, socket.id);
             if (room) {
                io.to(roomId).emit('roomStateUpdate', room);
             }
        });
    });
});

app.post('/api/evaluate-drawing', async (req, res) => {
    try {
        const { imageBase64, prompt } = req.body;
        if (!imageBase64 || !prompt) return res.status(400).json({ error: 'Missing imageBase64 or prompt' });
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [ { text: `Evaluate this drawing for the prompt: "${prompt}"` }, { inlineData: { data: base64Data, mimeType: "image/png" } } ] }
            ],
            config: { systemInstruction, responseMimeType: "application/json" }
        });
        res.json(JSON.parse(response.text));
    } catch (error) {
        console.error('Error evaluating drawing:', error);
        res.status(500).json({ error: 'Failed to evaluate drawing.' });
    }
});

httpServer.listen(port, () => {
    console.log(`DoodleDoom backend running on http://localhost:${port}`);
});
