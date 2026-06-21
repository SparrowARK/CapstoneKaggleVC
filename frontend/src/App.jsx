import React, { useRef, useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import './index.css';

// ─── Session ID: Persistent across page refreshes ───
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
  "Summoning the warriors...",
  "Charging up the arena...",
  "Consulting the ancient scrolls...",
  "Buffing the armor plates...",
  "Crunching the battle numbers...",
  "Sharpening the swords...",
  "Almost there..."
];

function App() {
  const canvasRef = useRef(null);
  const roomIdRef = useRef(null); // Stable ref for the auto-submit handler

  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [room, setRoom] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);

  // Battle State
  const [battleLog, setBattleLog] = useState(null);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [loadingIndex, setLoadingIndex] = useState(0);

  // ─── Socket Event Listeners (mounted once) ───
  useEffect(() => {
    socket.on('roomStateUpdate', (updatedRoom) => {
      setRoom(updatedRoom);
      roomIdRef.current = updatedRoom?.id;

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
      const currentRoomId = roomIdRef.current;
      if (canvas && currentRoomId) {
        const imageBase64 = canvas.toDataURL('image/png');
        socket.emit('submitDrawing', { roomId: currentRoomId, imageBase64 });
      }
    });

    socket.on('battleLog', (log) => {
      setBattleLog(log);
      setCurrentTurnIndex(0);
    });

    socket.on('battleError', (errorMsg) => {
      console.warn('Battle Error:', errorMsg);
    });

    return () => {
      socket.off('roomStateUpdate');
      socket.off('timerUpdate');
      socket.off('timesUp_submitDrawing');
      socket.off('battleLog');
      socket.off('battleError');
    };
  }, []); // Empty deps — mount once

  // ─── Canvas Setup ───
  useEffect(() => {
    if (room?.state === 'DRAWING' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'black';
    }
  }, [room?.state]);

  // ─── Loading Messages Rotation ───
  useEffect(() => {
    if (room?.state === 'EVALUATING' || (room?.state === 'BATTLING' && !battleLog)) {
      const interval = setInterval(() => {
        setLoadingIndex(prev => (prev + 1) % loadingMessages.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [room?.state, battleLog]);

  // ─── Battle Animation Buffer ───
  useEffect(() => {
    if (battleLog && currentTurnIndex < battleLog.length) {
      const event = battleLog[currentTurnIndex];
      setCurrentEvent(event);

      const delay = event.type === 'game_over' ? 4000 : 3000;
      const timer = setTimeout(() => {
        setCurrentTurnIndex(prev => prev + 1);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [battleLog, currentTurnIndex]);

  // ─── Actions ───
  const handleCreateRoom = useCallback((e) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    sessionStorage.setItem('doodledoom_current_room', newRoomId);
    socket.emit('joinRoom', { roomId: newRoomId, sessionId, playerName: playerName.trim() });
  }, [playerName]);

  const handleJoinRoom = useCallback((e) => {
    e.preventDefault();
    if (!roomId.trim() || !playerName.trim()) return;
    const normalizedRoomId = roomId.trim().toUpperCase();
    sessionStorage.setItem('doodledoom_current_room', normalizedRoomId);
    socket.emit('joinRoom', { roomId: normalizedRoomId, sessionId, playerName: playerName.trim() });
  }, [roomId, playerName]);

  const toggleReady = useCallback(() => {
    socket.emit('toggleReady', { roomId: room?.id, isReady: !isReady });
  }, [room?.id, isReady]);

  const startNextRound = useCallback(() => {
    socket.emit('startNextRound', { roomId: room?.id });
  }, [room?.id]);

  // ─── Canvas Drawing Handlers ───
  const startDrawing = useCallback(({ nativeEvent }) => {
    if (room?.state !== 'DRAWING') return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  }, [room?.state]);

  const finishDrawing = useCallback(() => {
    if (!isDrawing) return;
    canvasRef.current.getContext('2d').closePath();
    setIsDrawing(false);
  }, [isDrawing]);

  const draw = useCallback(({ nativeEvent }) => {
    if (!isDrawing || room?.state !== 'DRAWING') return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();
  }, [isDrawing, room?.state]);

  // ─── Render: Home / Join Screen ───
  if (!room) {
    return (
      <div className="app-container">
        <h1>DoodleDoom ⚔️</h1>
        <p style={{ textAlign: 'center', color: '#aaa' }}>Draw. Battle. Dominate.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', maxWidth: '320px', margin: '0 auto' }}>
          <input
            type="text"
            placeholder="Your Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={20}
            style={{ padding: '0.8rem 1rem', borderRadius: '10px', width: '100%', fontSize: '1rem', fontWeight: '600' }}
          />

          <div style={{ width: '100%', background: 'rgba(255,255,255,0.04)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button onClick={handleCreateRoom} style={{ width: '100%', marginBottom: '12px' }} disabled={!playerName.trim()}>
              Create New Room
            </button>
            <div style={{ textAlign: 'center', margin: '15px 0', fontSize: '0.85rem', color: '#555' }}>— OR —</div>
            <input
              type="text"
              placeholder="Enter Room Code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              maxLength={10}
              style={{ padding: '0.8rem 1rem', borderRadius: '10px', width: '100%', marginBottom: '12px', fontSize: '1.1rem', textAlign: 'center', letterSpacing: '3px', fontWeight: '700' }}
            />
            <button onClick={handleJoinRoom} style={{ width: '100%', background: 'linear-gradient(135deg, #444, #333)' }} disabled={!playerName.trim() || !roomId.trim()}>
              Join Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Helpers ───
  const renderStatBar = (label, value, max, isHp = false) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div className="stat-bar-container" key={label}>
        <div className="stat-label">{label}</div>
        <div className="stat-bar-bg">
          <div className={`stat-bar-fill${isHp ? ' hp' : ''}`} style={{ width: `${percentage}%` }}></div>
        </div>
        <div className="stat-value">{Math.round(value)}</div>
      </div>
    );
  };

  const isGameOver = currentEvent && currentEvent.type === 'game_over';
  const didIWin = isGameOver && currentEvent.winnerId === sessionId;

  // ─── Render: Game UI ───
  return (
    <div className="app-container">
      <h1>DoodleDoom ⚔️ <span style={{ fontSize: '0.9rem', color: '#666', marginLeft: '8px', fontWeight: '400' }}>Round {room.round || 1}</span></h1>

      {/* Status Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '12px 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div>Room: <span className="room-code">{room.id}</span></div>
        {room.state === 'DRAWING' && (
          <div style={{ fontSize: '1.5rem', color: timeRemaining <= 10 ? 'var(--danger-color)' : 'var(--accent-color)', fontWeight: '900', fontFamily: "'Outfit', sans-serif" }}>
            ⏱ {timeRemaining}s
          </div>
        )}
        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {room.state}
        </div>
      </div>

      {/* ─── LOBBY ─── */}
      {room.state === 'LOBBY' && (
        <div className="results-panel">
          <h2 style={{ textAlign: 'center' }}>Lobby</h2>
          <p style={{ textAlign: 'center', color: '#888', fontSize: '0.9rem' }}>Share code <span className="room-code">{room.id}</span> with friends!</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {Object.values(room.players).map(p => (
              <li key={p.id} className={`lobby-player${!p.connected ? ' disconnected' : ''}`}>
                <span style={{ fontWeight: '700' }}>
                  {p.name}
                  {p.id === sessionId && <span className="you-badge" style={{ display: 'inline-block', color: 'white', background: 'linear-gradient(135deg, var(--primary-color), #a06cdf)', padding: '2px 10px', borderRadius: '12px', fontSize: '0.7rem', marginLeft: '8px' }}>YOU</span>}
                  {!p.connected && <span style={{ color: '#666', marginLeft: '8px', fontSize: '0.8rem' }}>(Offline)</span>}
                </span>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  <span className="score-badge">🏆 {p.score || 0}</span>
                  <span style={{ color: p.isReady ? '#03dac6' : '#555', fontWeight: '700', fontSize: '0.85rem' }}>
                    {p.isReady ? '✅ READY' : '⏳ Waiting'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={toggleReady} style={{ marginTop: '20px', width: '100%', padding: '15px', fontSize: '1.1rem', ...(isReady ? { background: 'linear-gradient(135deg, #444, #333)' } : {}) }}>
            {isReady ? 'Cancel Ready' : "I'm Ready!"}
          </button>
        </div>
      )}

      {/* ─── DRAWING / EVALUATING ─── */}
      {(room.state === 'DRAWING' || room.state === 'EVALUATING') && (
        <>
          <div className="prompt-box">Draw: <strong>"{room.prompt}"</strong></div>
          <div style={{ pointerEvents: room.state === 'EVALUATING' ? 'none' : 'auto', opacity: room.state === 'EVALUATING' ? 0.5 : 1, transition: 'opacity 0.5s ease' }}>
            <canvas ref={canvasRef} width={600} height={400} className="canvas-container"
              onMouseDown={startDrawing} onMouseUp={finishDrawing} onMouseOut={finishDrawing} onMouseMove={draw}
            />
          </div>
          {room.state === 'EVALUATING' && (
            <h2 className="loading-text">{loadingMessages[loadingIndex]}</h2>
          )}
        </>
      )}

      {/* ─── BATTLING ─── */}
      {room.state === 'BATTLING' && (
        <div className="results-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ margin: 0 }}>⚔️ Arena</h2>
            {isGameOver && (
              <button onClick={startNextRound} style={{ padding: '10px 24px', fontSize: '1rem' }}>
                Next Round →
              </button>
            )}
          </div>

          {/* Commentary */}
          {currentEvent ? (
            <div className="commentary-box">
              {currentEvent.commentator && (
                <div className="commentator-text">🎤 "{currentEvent.commentator}"</div>
              )}
              <div className="action-text">{currentEvent.message}</div>
            </div>
          ) : (
            <h2 className="loading-text">{loadingMessages[loadingIndex]}</h2>
          )}

          {/* Win/Lose Banner */}
          {isGameOver && (
            <div className={`win-banner ${didIWin ? 'victory' : 'defeat'}`}>
              <h1 style={{ fontSize: '2.5rem', color: didIWin ? 'var(--win-color)' : 'var(--lose-color)', background: 'none', WebkitTextFillColor: 'unset', WebkitBackgroundClip: 'unset' }}>
                {didIWin ? "🎉 YOU WIN!" : "💀 YOU LOSE!"}
              </h1>
            </div>
          )}

          {/* Player Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {Object.values(room.players).map(p => {
              let liveHp = p.stats?.stats?.hp || 0;
              if (battleLog && currentTurnIndex > 0) {
                for (let i = 0; i <= Math.min(currentTurnIndex, battleLog.length - 1); i++) {
                  const ev = battleLog[i];
                  if (ev?.type === 'attack' && ev.targetId === p.id) {
                    liveHp = ev.targetRemainingHp;
                  }
                }
              }

              const isTaunting = currentEvent?.actorId === p.id && currentEvent?.actorTaunt;

              return (
                <div key={p.id} className={`player-card${liveHp <= 0 ? ' defeated' : ''}`}>
                  {isTaunting && (
                    <div className="taunt-bubble">🗯️ "{currentEvent.actorTaunt}"</div>
                  )}

                  <h3 style={{ margin: '0 0 8px 0', color: liveHp > 0 ? 'var(--accent-color)' : '#555', display: 'flex', alignItems: 'center', fontFamily: "'Outfit', sans-serif" }}>
                    {p.name}
                    {p.id === sessionId && <span className="you-badge">YOU</span>}
                    {liveHp <= 0 && <span style={{ marginLeft: '8px' }}>☠️</span>}
                  </h3>

                  <div className="score-badge" style={{ marginBottom: '10px' }}>🏆 {p.score || 0}</div>

                  {p.stats?.visualDescription && (
                    <div style={{ fontStyle: 'italic', fontSize: '0.8rem', color: '#888', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {p.stats.visualDescription}
                    </div>
                  )}

                  {p.stats ? (
                    <>
                      {renderStatBar('HP', liveHp, p.stats.stats.hp, true)}
                      {renderStatBar('ATK', p.stats.stats.attack, 50)}
                      {renderStatBar('DEF', p.stats.stats.defense, 40)}
                      {renderStatBar('SPD', p.stats.stats.speed, 100)}
                    </>
                  ) : (
                    <p style={{ color: '#555' }}>Awaiting evaluation...</p>
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
