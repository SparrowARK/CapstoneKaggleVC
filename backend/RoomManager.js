// RoomManager.js
// Abstract interface for game state, now supporting Session-based State Recovery.

const rooms = new Map();

export class RoomManager {
    static getRoom(roomId) {
        return rooms.get(roomId);
    }

    static createRoom(roomId) {
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                state: 'LOBBY', // LOBBY, DRAWING, EVALUATING, BATTLING
                players: {}, // sessionId -> { id: sessionId, socketId, name, isReady, drawingBase64, stats, connected: boolean }
                prompt: "A defensive turtle-mech with laser cannons", 
                timerInterval: null,
                timeRemaining: 0
            });
        }
        return rooms.get(roomId);
    }

    static addPlayer(roomId, sessionId, socketId, name) {
        const room = this.getRoom(roomId) || this.createRoom(roomId);
        
        if (room.players[sessionId]) {
            // Reconnecting player
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
                connected: true
            };
        }
        return room;
    }

    static disconnectPlayer(roomId, socketId) {
        const room = this.getRoom(roomId);
        if (room) {
            // Find player by socketId
            const player = Object.values(room.players).find(p => p.socketId === socketId);
            if (player) {
                player.connected = false;
                
                // If everyone is disconnected, clean up room
                const anyConnected = Object.values(room.players).some(p => p.connected);
                if (!anyConnected) {
                    if (room.timerInterval) clearInterval(room.timerInterval);
                    rooms.delete(roomId);
                    return null; // Room destroyed
                }
            }
        }
        return room;
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
        const players = Object.values(room.players);
        if (players.length === 0) return false;
        return players.every(p => p.isReady);
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
}
