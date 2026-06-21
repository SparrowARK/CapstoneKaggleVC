import React, { useRef, useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './index.css';

// Generate or load a persistent Session ID for state recovery
const getSessionId = () => {
  let sid = sessionStorage.getItem('doodledoom_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem('doodledoom_session_id', sid);
  }
  return sid;
};

const sessionId = getSessionId();
const socket = io('http://localhost:3001');

const loadingMessages = [
  "Tuning laser cannons...",
  "Going to the arena...",
  "Consulting the ancient scrolls...",
  "Buffing the armor...",
  "Crunching the battle numbers...",
  "Almost there..."
];

function App() {
  const canvasRef = useRef(null);
  
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [room, setRoom] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);

  // Battle State Buffer
  const [battleLog, setBattleLog] = useState(null);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [loadingIndex, setLoadingIndex] = useState(0);

  useEffect(() => {
    socket.on('roomStateUpdate', (updatedRoom) => {
      setRoom(updatedRoom);
      
      // Sync local ready state with server state for state recovery
      if (updatedRoom?.players[sessionId]) {
         setIsReady(updatedRoom.players[sessionId].isReady);
      }

      if (updatedRoom.state === 'LOBBY' || updatedRoom.state === 'DRAWING') {
        setBattleLog(null);
        setCurrentTurnIndex(0);
        setCurrentEvent(null);
      }
    });

    socket.on('timerUpdate', (time) => {
      setTimeRemaining(time);
    });

    socket.on('timesUp_submitDrawing', () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const imageBase64 = canvas.toDataURL('image/png');
        socket.emit('submitDrawing', { roomId: room?.id, imageBase64 });
      }
    });

    socket.on('battleLog', (log) => {
      setBattleLog(log);
      setCurrentTurnIndex(0);
    });

    socket.on('battleError', (errorMsg) => {
      alert(errorMsg);
    });

    // Rejoin automatically if room exists in state (on refresh)
    const savedRoomId = sessionStorage.getItem('doodledoom_current_room');
    if (savedRoomId && !room) {
        setRoomId(savedRoomId);
    }

    return () => {
      socket.off('roomStateUpdate');
      socket.off('timerUpdate');
      socket.off('timesUp_submitDrawing');
      socket.off('battleLog');
      socket.off('battleError');
    };
  }, [room?.id]);

  useEffect(() => {
    if (room?.state === 'DRAWING' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      // If state recovery brought back a drawing, we would render it here
      // For now, just clear white
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'black';
    }
  }, [room?.state]);

  // Loading Messages Interval
  useEffect(() => {
    if (room?.state === 'EVALUATING' || (room?.state === 'BATTLING' && !battleLog)) {
      const interval = setInterval(() => {
        setLoadingIndex(prev => (prev + 1) % loadingMessages.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [room?.state, battleLog]);

  // Battle Animation Buffer Loop
  useEffect(() => {
    if (battleLog && currentTurnIndex < battleLog.length) {
      const event = battleLog[currentTurnIndex];
      setCurrentEvent(event);

      // Determine animation speed based on event type
      const delay = event.type === 'game_over' ? 5000 : 3500; 

      const timer = setTimeout(() => {
        setCurrentTurnIndex(prev => prev + 1);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [battleLog, currentTurnIndex]);

  const joinRoom = (e) => {
    e.preventDefault();
    if (roomId && playerName) {
      sessionStorage.setItem('doodledoom_current_room', roomId);
      socket.emit('joinRoom', { roomId, sessionId, playerName });
    }
  };

  const toggleReady = () => {
    const nextReadyState = !isReady;
    setIsReady(nextReadyState);
    socket.emit('toggleReady', { roomId, isReady: nextReadyState });
  };

  const startDrawing = ({ nativeEvent }) => {
    if (room?.state !== 'DRAWING') return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const finishDrawing = () => {
    if (room?.state !== 'DRAWING') return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.closePath();
    setIsDrawing(false);
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing || room?.state !== 'DRAWING') return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();
  };

  if (!room) {
    return (
      <div className="app-container">
        <h1>DoodleDoom ⚔️</h1>
        <p>Join a room to battle your friends!</p>
        <form onSubmit={joinRoom} style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
          <input type="text" placeholder="Your Name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} required style={{ padding: '0.5rem', borderRadius: '4px', border: 'none', width: '200px' }} />
          <input type="text" placeholder="Room Code" value={roomId} onChange={(e) => setRoomId(e.target.value)} required style={{ padding: '0.5rem', borderRadius: '4px', border: 'none', width: '200px' }} />
          <button type="submit">Join / Rejoin Room</button>
        </form>
      </div>
    );
  }

  const renderStatBar = (label, value, max) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div className="stat-bar-container" key={label}>
        <div className="stat-label">{label}</div>
        <div className="stat-bar-bg"><div className="stat-bar-fill" style={{ width: `${percentage}%` }}></div></div>
        <div className="stat-value">{value}</div>
      </div>
    );
  };

  return (
    <div className="app-container">
      <h1>DoodleDoom ⚔️</h1>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><strong>Room:</strong> {room.id}</div>
        {room.state === 'DRAWING' && (
          <div style={{ fontSize: '1.5rem', color: timeRemaining <= 10 ? 'red' : 'var(--accent-color)', fontWeight: 'bold' }}>
            ⏱ {timeRemaining}s
          </div>
        )}
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
          State: {room.state}
        </div>
      </div>

      {room.state === 'LOBBY' && (
        <div className="results-panel">
          <h2>Lobby</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {Object.values(room.players).map(p => (
              <li key={p.id} style={{ padding: '10px', margin: '5px 0', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', opacity: p.connected ? 1 : 0.5 }}>
                <span>{p.name} {p.id === sessionId ? '(You)' : ''} {!p.connected && '(Disconnected)'}</span>
                <span style={{ color: p.isReady ? '#0f0' : '#aaa' }}>{p.isReady ? 'READY' : 'Not Ready'}</span>
              </li>
            ))}
          </ul>
          <button onClick={toggleReady} style={{ marginTop: '10px', background: isReady ? '#555' : 'var(--primary-color)' }}>
            {isReady ? 'Unready' : 'I am Ready!'}
          </button>
        </div>
      )}

      {(room.state === 'DRAWING' || room.state === 'EVALUATING') && (
        <>
          <div className="prompt-box">Prompt: <strong>"{room.prompt}"</strong></div>
          <div className="canvas-wrapper" style={{ pointerEvents: room.state === 'EVALUATING' ? 'none' : 'auto', opacity: room.state === 'EVALUATING' ? 0.5 : 1 }}>
            <canvas ref={canvasRef} width={600} height={400} className="canvas-container" onMouseDown={startDrawing} onMouseUp={finishDrawing} onMouseOut={finishDrawing} onMouseMove={draw} />
          </div>
          {room.state === 'EVALUATING' && (
            <h2 style={{ color: 'var(--accent-color)', animation: 'fadeIn 1s infinite alternate' }}>
              {loadingMessages[loadingIndex]}
            </h2>
          )}
        </>
      )}

      {room.state === 'BATTLING' && (
        <div className="results-panel">
          <h2>Warriors Ready! ⚔️</h2>
          
          {currentEvent ? (
            <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', borderLeft: '4px solid var(--accent-color)' }}>
               {currentEvent.commentator && (
                 <div style={{ fontStyle: 'italic', color: '#ffb74d', marginBottom: '10px' }}>
                   🎤 Commentator: "{currentEvent.commentator}"
                 </div>
               )}
               <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                 {currentEvent.message}
               </div>
            </div>
          ) : (
            <h2 style={{ color: 'var(--accent-color)', animation: 'fadeIn 1s infinite alternate', textAlign: 'center' }}>
              {loadingMessages[loadingIndex]}
            </h2>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {Object.values(room.players).map(p => {
              // Calculate live HP based on battle log up to current index
              let liveHp = p.stats?.stats.hp || 0;
              if (battleLog && currentTurnIndex > 0) {
                 for (let i = 0; i <= currentTurnIndex; i++) {
                   const ev = battleLog[i];
                   if (ev && ev.type === 'attack' && ev.targetId === p.id) {
                     liveHp = ev.targetRemainingHp;
                   }
                 }
              }

              // Check if player is currently taunting
              const isTaunting = currentEvent && currentEvent.actorId === p.id && currentEvent.actorTaunt;

              return (
                <div key={p.id} style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px', opacity: liveHp <= 0 ? 0.5 : 1, position: 'relative' }}>
                  
                  {isTaunting && (
                    <div style={{ position: 'absolute', top: '-40px', left: '10px', background: 'white', color: 'black', padding: '8px', borderRadius: '12px', zIndex: 10, animation: 'fadeIn 0.2s' }}>
                      🗯️ "{currentEvent.actorTaunt}"
                    </div>
                  )}

                  <h3 style={{ margin: '0 0 10px 0', color: liveHp > 0 ? 'var(--accent-color)' : '#777' }}>
                    {p.name} {liveHp <= 0 && '☠️'}
                  </h3>

                  {p.stats && p.stats.visualDescription && (
                    <div style={{ fontStyle: 'italic', fontSize: '0.85rem', color: '#ccc', marginBottom: '15px', borderBottom: '1px solid #555', paddingBottom: '10px' }}>
                      <strong>Warrior Profile:</strong> {p.stats.visualDescription}
                    </div>
                  )}
                  
                  {p.stats ? (
                    <>
                      {renderStatBar('HP', liveHp, p.stats.stats.hp)}
                      {renderStatBar('ATK', p.stats.stats.attack, 50)}
                      {renderStatBar('DEF', p.stats.stats.defense, 40)}
                      {renderStatBar('SPD', p.stats.stats.speed, 100)}
                    </>
                  ) : (
                    <p>Evaluation failed.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
