'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// Dynamic import for xterm to avoid SSR issues
import dynamic from 'next/dynamic';

interface ShellMessage {
  type: 'info' | 'output' | 'error' | 'closed' | 'exit' | 'ping' | 'pong';
  data?: string;
  state?: string;
  message?: string;
  reason?: string;
  code?: number;
  shell_type?: string;
}

export default function ShellPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const [status, setStatus] = useState<'idle' | 'connecting' | 'pending' | 'active' | 'error' | 'closed'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shellType, setShellType] = useState<'powershell' | 'cmd' | 'bash'>('powershell');
  const [commandCount, setCommandCount] = useState(0);
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  
  // Start shell session
  const startSession = async () => {
    setStatus('connecting');
    setError(null);
    
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(
        `http://${window.location.hostname}:8080/api/v1/shell/start/${nodeId}?shell_type=${shellType}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to start session: ${response.statusText}`);
      }
      
      const data = await response.json();
      setSessionId(data.session_id);
      setStatus('pending');
      
      // Initialize terminal
      await initTerminal();
      
      // Connect WebSocket
      connectWebSocket(data.session_id, token!);
      
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };
  
  // Initialize xterm.js
  const initTerminal = async () => {
    if (xtermRef.current || !terminalRef.current) return;
    
    // Dynamically import xterm
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    
    // Load xterm CSS via link element (dynamic import doesn't work in Next.js)
    if (!document.querySelector('link[href*="xterm"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css';
      document.head.appendChild(link);
    }
    
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      }
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();
    
    // Handle input
    term.onData((data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
        setCommandCount(c => c + 1);
      }
    });
    
    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    
    term.writeln('\x1b[1;34m🐙 Octofleet Remote Shell\x1b[0m');
    term.writeln('\x1b[90mConnecting to ' + nodeId + '...\x1b[0m');
    term.writeln('');
  };
  
  // Connect WebSocket
  const connectWebSocket = (sid: string, token: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8080/api/v1/shell/ws/${sid}?token=${token}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('Shell WebSocket connected');
    };
    
    ws.onmessage = (event) => {
      const msg: ShellMessage = JSON.parse(event.data);
      handleMessage(msg);
    };
    
    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setError('WebSocket connection failed');
      setStatus('error');
    };
    
    ws.onclose = () => {
      console.log('WebSocket closed');
      if (status === 'active') {
        setStatus('closed');
      }
    };
  };
  
  // Handle incoming messages
  const handleMessage = useCallback((msg: ShellMessage) => {
    switch (msg.type) {
      case 'info':
        if (msg.state === 'active') {
          setStatus('active');
          xtermRef.current?.writeln('\x1b[1;32m✓ Connected!\x1b[0m');
          xtermRef.current?.writeln('');
        }
        break;
        
      case 'output':
        if (msg.data) {
          xtermRef.current?.write(msg.data);
        }
        break;
        
      case 'error':
        setError(msg.message || 'Unknown error');
        xtermRef.current?.writeln(`\x1b[1;31mError: ${msg.message}\x1b[0m`);
        break;
        
      case 'exit':
        xtermRef.current?.writeln('');
        xtermRef.current?.writeln(`\x1b[90mProcess exited with code ${msg.code}\x1b[0m`);
        setStatus('closed');
        break;
        
      case 'closed':
        setStatus('closed');
        setError(msg.reason || 'Session closed');
        xtermRef.current?.writeln('');
        xtermRef.current?.writeln(`\x1b[1;33mSession closed: ${msg.reason}\x1b[0m`);
        break;
        
      case 'ping':
        wsRef.current?.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }, []);
  
  // Stop session
  const stopSession = async () => {
    if (sessionId) {
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`http://${window.location.hostname}:8080/api/v1/shell/stop/${sessionId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (err) {
        console.error('Error stopping session:', err);
      }
    }
    
    wsRef.current?.close();
    setSessionId(null);
    setStatus('idle');
    setCommandCount(0);
    
    // Clear terminal
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, []);
  
  // Keep-alive ping
  useEffect(() => {
    if (status !== 'active') return;
    
    const interval = setInterval(() => {
      wsRef.current?.send(JSON.stringify({ type: 'ping' }));
    }, 30000);
    
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
        <span className="text-white">Shell</span>
      </nav>
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          🖥️ Remote Shell: {nodeId}
        </h1>
        
        <div className="flex items-center gap-4">
          {/* Shell Type Selector */}
          {status === 'idle' && (
            <select
              value={shellType}
              onChange={(e) => setShellType(e.target.value as any)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2"
            >
              <option value="powershell">PowerShell</option>
              <option value="cmd">CMD</option>
              <option value="bash">Bash</option>
            </select>
          )}
          
          {/* Status Badge */}
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            status === 'active' ? 'bg-green-600' :
            status === 'pending' ? 'bg-yellow-600' :
            status === 'connecting' ? 'bg-blue-600' :
            status === 'error' ? 'bg-red-600' :
            'bg-gray-600'
          }`}>
            {status === 'active' ? '● CONNECTED' :
             status === 'pending' ? '⏳ Waiting...' :
             status === 'connecting' ? '🔄 Connecting...' :
             status === 'error' ? '❌ Error' :
             status === 'closed' ? '⬤ Closed' :
             '○ Ready'}
          </span>
          
          {/* Command Count */}
          {status === 'active' && (
            <span className="text-gray-400 text-sm">
              📝 {commandCount} commands
            </span>
          )}
        </div>
      </div>
      
      {/* Error Message */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded p-3 text-red-200">
          ⚠️ {error}
        </div>
      )}
      
      {/* Controls */}
      <div className="flex gap-4">
        {status === 'idle' || status === 'error' || status === 'closed' ? (
          <button
            onClick={startSession}
            className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-medium"
          >
            ▶️ Start Shell
          </button>
        ) : (
          <button
            onClick={stopSession}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-medium"
          >
            ⏹️ Stop Shell
          </button>
        )}
        
        <Link
          href={`/nodes/${nodeId}`}
          className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded"
        >
          ← Back to Node
        </Link>
      </div>
      
      {/* Terminal */}
      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <div
          ref={terminalRef}
          className="w-full"
          style={{ height: '500px', padding: '8px' }}
        />
      </div>
      
      {/* Info */}
      <div className="text-sm text-gray-500 space-y-1">
        <p>💡 Shell type: <span className="text-gray-300">{shellType}</span></p>
        <p>🔐 All commands are logged for audit purposes.</p>
        <p>⏱️ Sessions timeout after 30 minutes of inactivity.</p>
      </div>
    </div>
  );
}
