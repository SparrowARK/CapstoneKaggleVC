// RoomManager.js — Production-grade game state management
// Supports session-based recovery, multi-round scoring, and safe serialization.

const rooms = new Map();

// Prompts pool — expanded to 15 for variety across rounds
const PROMPTS = [
    "A defensive turtle-mech with laser cannons",
    "A fiery phoenix knight with a flaming sword",
    "A cybernetic ninja frog with energy shurikens",
    "An armored space bear with plasma blasters",
    "A steampunk wizard owl with gear-driven magic",
    "A shadow dragon assassin with poison claws",
    "A crystal golem warrior with diamond fists",
    "A rocket-powered Viking shark with a battle axe",
    "A neon samurai cat with dual plasma swords",
    "A haunted pirate ship captain with ghost cannons",
    "A volcanic rock titan with erupting fists",
    "A clockwork spider queen with web traps",
    "A winged serpent sorceress with ice breath",
    "A desert scorpion gladiator with acid tail",
    "A galactic jellyfish mage with lightning tentacles"
];

export class RoomManager {
    static getRoom(roomId) {
        return rooms.get(roomId);
    }

    static createRoom(roomId) {
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                round: 1,
                state: 'LOBBY', // LOBBY, DRAWING, EVALUATING, BATTLING
                players: {},
                prompt: this._getRandomPrompt(),
                timerInterval: null,  // Server-only, never serialized to clients
                timeRemaining: 0
            });
        }
        return rooms.get(roomId);
    }

    /**
     * Returns a sanitized copy of the room state safe to send to clients.
     * Strips server-only fields (timerInterval) and large binary data (drawingBase64).
     */
    static sanitizeRoom(room) {
        if (!room) return null;
        const { timerInterval, ...safeRoom } = room;
        safeRoom.players = {};
        for (const [key, player] of Object.entries(room.players)) {
            const { drawingBase64, ...safePlayer } = player;
            safeRoom.players[key] = safePlayer;
        }
        return safeRoom;
    }

    static _getRandomPrompt() {
        return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    }

    static addPlayer(roomId, sessionId, socketId, name) {
        const room = this.getRoom(roomId) || this.createRoom(roomId);

        if (room.players[sessionId]) {
            // Reconnecting player — update socket mapping
            room.players[sessionId].socketId = socketId;
            room.players[sessionId].connected = true;
            if (name) room.players[sessionId].name = name;
        } else {
            // New player
            room.players[sessionId] = {
                id: sessionId,
                socketId: socketId,
                name: name || `Player_${sessionId.substring(0, 4)}`,
                isReady: false,
                drawingBase64: null,
                stats: null,
                score: 0,
                connected: true
            };
        }
        return room;
    }

    static disconnectPlayer(roomId, socketId) {
        const room = this.getRoom(roomId);
        if (!room) return null;

        const player = Object.values(room.players).find(p => p.socketId === socketId);
        if (player) {
            player.connected = false;

            // If all players disconnected, tear down the room entirely
            const anyConnected = Object.values(room.players).some(p => p.connected);
            if (!anyConnected) {
                if (room.timerInterval) clearInterval(room.timerInterval);
                rooms.delete(roomId);
                return null; // Room destroyed
            }
        }
        return room;
    }

    static getConnectedPlayerCount(roomId) {
        const room = this.getRoom(roomId);
        if (!room) return 0;
        return Object.values(room.players).filter(p => p.connected).length;
    }

    static setPlayerReady(roomId, sessionId, isReady) {
        const room = this.getRoom(roomId);
        if (room && room.players[sessionId]) {
            room.players[sessionId].isReady = isReady;
        }
        return room;
    }

    static areAllPlayersReady(roomId) {
        const room = this.getRoom(roomId);
        if (!room) return false;
        const connectedPlayers = Object.values(room.players).filter(p => p.connected);
        if (connectedPlayers.length < 2) return false; // Need at least 2 players
        return connectedPlayers.every(p => p.isReady);
    }

    static setPlayerDrawing(roomId, sessionId, drawingBase64) {
        const room = this.getRoom(roomId);
        if (room && room.players[sessionId]) {
            room.players[sessionId].drawingBase64 = drawingBase64;
        }
        return room;
    }

    static setPlayerStats(roomId, sessionId, stats) {
        const room = this.getRoom(roomId);
        if (room && room.players[sessionId]) {
            room.players[sessionId].stats = stats;
        }
        return room;
    }

    static incrementScore(roomId, sessionId) {
        const room = this.getRoom(roomId);
        if (room && room.players[sessionId]) {
            room.players[sessionId].score += 1;
        }
        return room;
    }

    static resetRoomForNextRound(roomId) {
        const room = this.getRoom(roomId);
        if (!room) return null;

        room.round += 1;
        room.state = 'LOBBY';
        room.prompt = this._getRandomPrompt();
        if (room.timerInterval) clearInterval(room.timerInterval);
        room.timerInterval = null;
        room.timeRemaining = 0;

        Object.values(room.players).forEach(p => {
            p.isReady = false;
            p.drawingBase64 = null;
            p.stats = null;
        });

        return room;
    }
}
