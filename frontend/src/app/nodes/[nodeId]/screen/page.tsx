'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface ScreenMessage {
  type: 'info' | 'frame' | 'error' | 'closed' | 'ping' | 'pong';
  data?: string;
  width?: number;
  height?: number;
  message?: string;
  state?: string;
  reason?: string;
  session_id?: string;
  node_id?: string;
  quality?: string;
}

export default function ScreenViewerPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.nodeId as string;
  
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'pending' | 'streaming' | 'error' | 'closed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ frames: 0, fps: 0, latency: 0 });
  const [quality, setQuality] = useState('medium');
  const [maxFps, setMaxFps] = useState(15);
  
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(Date.now());
  
  const startSession = async () => {
    setStatus('connecting');
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/screen/start/${nodeId}?quality=${quality}&max_fps=${maxFps}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to start session');
      }
      
      const data = await response.json();
      setSessionId(data.session_id);
      setStatus('pending');
      
      // Connect WebSocket
      connectWebSocket(data.session_id, token!);
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };
  
  const connectWebSocket = (sid: string, token: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname.includes('localhost') ? 'localhost' : window.location.hostname}:8080/api/v1/screen/ws/${sid}?token=${token}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
      const msg: ScreenMessage = JSON.parse(event.data);
      handleMessage(msg);
    };
    
    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setError('WebSocket connection failed');
      setStatus('error');
    };
    
    ws.onclose = () => {
      console.log('WebSocket closed');
      if (status === 'streaming') {
        setStatus('closed');
      }
    };
  };
  
  const handleMessage = useCallback((msg: ScreenMessage) => {
    switch (msg.type) {
      case 'info':
        if (msg.state === 'active') {
          setStatus('streaming');
        }
        break;
        
      case 'frame':
        if (msg.data) {
          renderFrame(msg.data, msg.width || 1920, msg.height || 1080);
          
          // Update stats
          frameCountRef.current++;
          const now = Date.now();
          const elapsed = now - lastFrameTimeRef.current;
          if (elapsed >= 1000) {
            setStats(prev => ({
              ...prev,
              frames: frameCountRef.current,
              fps: Math.round(frameCountRef.current / (elapsed / 1000))
            }));
            frameCountRef.current = 0;
            lastFrameTimeRef.current = now;
          }
        }
        break;
        
      case 'error':
        setError(msg.message || 'Unknown error');
        setStatus('error');
        break;
        
      case 'closed':
        setStatus('closed');
        setError(msg.reason || 'Session closed');
        break;
        
      case 'ping':
        wsRef.current?.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }, []);
  
  const renderFrame = (base64: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size if needed
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    
    // Draw frame
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  };
  
  const stopSession = async () => {
    if (sessionId) {
      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_URL}/api/v1/screen/session/${sessionId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (err) {
        console.error('Error stopping session:', err);
      }
    }
    
    wsRef.current?.close();
    setStatus('idle');
    setSessionId(null);
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);
  
  // Keep-alive ping
  useEffect(() => {
    if (status !== 'streaming') return;
    
    const interval = setInterval(() => {
      wsRef.current?.send(JSON.stringify({ type: 'ping' }));
    }, 15000);
    
    return () => clearInterval(interval);
  }, [status]);
  
  return (
    <div className="p-6 space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center space-x-2 text-sm text-gray-400">
        <Link href="/" className="hover:text-white">Dashboard</Link>
        <span>/</span>
        <Link href="/nodes" className="hover:text-white">Nodes</Link>
        <span>/</span>
        <Link href={`/nodes/${nodeId}`} className="hover:text-white">{nodeId}</Link>
        <span>/</span>
        <span className="text-white">Screen</span>
      </nav>
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          🖥️ Screen View: {nodeId}
        </h1>
        
        <div className="flex items-center gap-4">
          {/* Quality selector */}
          {status === 'idle' && (
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="bg-zinc-800 text-white border border-zinc-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="low">Low (720p, 30%)</option>
              <option value="medium">Medium (1080p, 50%)</option>
              <option value="high">High (1440p, 75%)</option>
            </select>
          )}
          
          {/* FPS selector */}
          {status === 'idle' && (
            <select
              value={maxFps}
              onChange={(e) => setMaxFps(parseInt(e.target.value))}
              className="bg-zinc-800 text-white border border-zinc-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="5">5 FPS</option>
              <option value="10">10 FPS</option>
              <option value="15">15 FPS</option>
              <option value="20">20 FPS</option>
              <option value="30">30 FPS</option>
            </select>
          )}
          
          {/* Start/Stop button */}
          {status === 'idle' || status === 'error' || status === 'closed' ? (
            <button
              onClick={startSession}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
            >
              ▶️ Start Viewing
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
            >
              ⏹️ Stop
            </button>
          )}
        </div>
      </div>
      
      {/* Status bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className={`px-2 py-1 rounded ${
          status === 'streaming' ? 'bg-green-600' :
          status === 'pending' ? 'bg-yellow-600' :
          status === 'connecting' ? 'bg-blue-600' :
          status === 'error' ? 'bg-red-600' :
          'bg-gray-600'
        }`}>
          {status === 'streaming' ? '🔴 LIVE' :
           status === 'pending' ? '⏳ Waiting for agent...' :
           status === 'connecting' ? '🔄 Connecting...' :
           status === 'error' ? '❌ Error' :
           status === 'closed' ? '⏹️ Stopped' :
           '⚪ Ready'}
        </span>
        
        {status === 'streaming' && (
          <>
            <span className="text-gray-400">
              📊 {stats.fps} FPS
            </span>
            <span className="text-gray-400">
              🖼️ {stats.frames} frames
            </span>
          </>
        )}
        
        {error && (
          <span className="text-red-400">⚠️ {error}</span>
        )}
      </div>
      
      {/* Canvas container */}
      <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
        {status === 'idle' ? (
          <div className="flex items-center justify-center h-96 text-gray-500">
            <div className="text-center">
              <div className="text-6xl mb-4">🖥️</div>
              <p>Click "Start Viewing" to begin screen sharing</p>
              <p className="text-sm mt-2">The agent must be online and updated to v0.4.24+</p>
            </div>
          </div>
        ) : status === 'pending' ? (
          <div className="flex items-center justify-center h-96 text-gray-400">
            <div className="text-center">
              <div className="animate-pulse text-6xl mb-4">⏳</div>
              <p>Waiting for agent to connect...</p>
              <p className="text-sm mt-2">Session ID: {sessionId}</p>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-auto"
            style={{ maxHeight: '80vh' }}
          />
        )}
      </div>
      
      {/* Info */}
      <div className="text-sm text-gray-500">
        <p>💡 Screen sharing uses JPEG compression. Quality and FPS affect bandwidth usage.</p>
        <p>🔒 All data is transmitted over encrypted WebSocket connection.</p>
      </div>
    </div>
  );
}
