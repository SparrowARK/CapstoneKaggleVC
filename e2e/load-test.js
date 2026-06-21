import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const ROOM_ID = 'LOAD_TEST_ROOM';
const NUM_PLAYERS = 10; // Number of concurrent bots
const TEST_IMAGE_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // 1x1 black pixel

let clientsReady = 0;
let evaluationsReceived = 0;

console.log(`Starting load test with ${NUM_PLAYERS} concurrent players...`);

for (let i = 0; i < NUM_PLAYERS; i++) {
    const socket = io(URL);
    const sessionId = `load_test_session_${i}`;
    const playerName = `Bot_${i}`;

    socket.on('connect', () => {
        // Join room
        socket.emit('joinRoom', { roomId: ROOM_ID, sessionId, playerName });
        
        // Emulate human delay then hit ready
        setTimeout(() => {
            socket.emit('toggleReady', { roomId: ROOM_ID, isReady: true });
            clientsReady++;
            if (clientsReady === NUM_PLAYERS) {
                console.log(`All ${NUM_PLAYERS} bots are ready! Timer should start.`);
            }
        }, 1000 + (i * 100)); // Stagger ready calls slightly
    });

    // When the timer ends and server asks to submit drawing
    socket.on('timesUp_submitDrawing', () => {
        console.log(`${playerName} submitting drawing...`);
        socket.emit('submitDrawing', { roomId: ROOM_ID, imageBase64: TEST_IMAGE_BASE64 });
    });

    socket.on('playerEvaluated', (data) => {
        if (data.sessionId === sessionId) {
            console.log(`✅ ${playerName} successfully evaluated! Match Score: ${data.stats.matchScore}`);
            evaluationsReceived++;
            if (evaluationsReceived === NUM_PLAYERS) {
                console.log(`\n🎉 LOAD TEST COMPLETE: All ${NUM_PLAYERS} drawings were successfully processed by the Gemini API under load!`);
            }
        }
    });

    socket.on('battleLog', (log) => {
        if (i === 0) { // Only log once
            console.log(`\n⚔️ BATTLE LOG RECEIVED: ${log.length} events processed by MCP Engine!`);
            console.log('Sample Event:', log[log.length - 1]);
            process.exit(0);
        }
    });

    socket.on('battleError', (err) => {
        console.error(`❌ ${playerName} received error:`, err);
    });
}
