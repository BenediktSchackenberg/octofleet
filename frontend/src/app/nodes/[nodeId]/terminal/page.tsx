"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui-components";
import { Terminal, Play, Square, Trash2 } from "lucide-react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080') + '/api/v1';

export default function TerminalPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shell, setShell] = useState<'powershell' | 'cmd' | 'bash'>('powershell');
  const [output, setOutput] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Helper for API headers
  const getHeaders = (contentType = false): Record<string, string> => {
    const headers: Record<string, string> = {
      'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'octofleet-dev-key'
    };
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (contentType) headers['Content-Type'] = 'application/json';
    return headers;
  };

  // Poll for output
  useEffect(() => {
    if (sessionId) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/terminal/session/${sessionId}/output`, {
            headers: getHeaders()
          });
          if (res.ok) {
            const data = await res.json();
            if (data.output && data.output.length > 0) {
              setOutput(prev => [...prev, ...data.output]);
              setConnected(true);
            }
          }
        } catch (e) {}
      }, 500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId]);

  async function startSession() {
    setLoading(true);
    setOutput([`[Starting ${shell} session...]\n`]);
    try {
      const res = await fetch(`${API_BASE}/terminal/start/${nodeId}`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ shell })
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.sessionId);
        setOutput([`[Session started: ${shell}]\n`]);
      } else {
        const errorText = await res.text();
        setOutput([`[Error: ${res.status} - ${errorText}]\n`]);
      }
    } catch (e) {
      console.error('Failed to start session:', e);
      setOutput([`[Connection failed: ${e}]\n`]);
    }
    setLoading(false);
  }

  async function stopSession() {
    if (!sessionId) return;
    try {
      await fetch(`${API_BASE}/terminal/session/${sessionId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
    } catch (e) {}
    setSessionId(null);
    setOutput(prev => [...prev, '\n[Session ended]\n']);
    setConnected(false);
  }

  async function sendCommand() {
    if (!sessionId || !input.trim()) return;
    
    const cmd = input.trim();
    setOutput(prev => [...prev, `\n> ${cmd}\n`]);
    setInput('');
    
    try {
      await fetch(`${API_BASE}/terminal/session/${sessionId}/input`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ command: cmd })
      });
    } catch (e) {
      setOutput(prev => [...prev, '[Error sending command]\n']);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
    }
  };

  return (
    <main className="min-h-screen bg-background p-8">
      <Breadcrumb items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Nodes', href: '/nodes' },
        { label: nodeId, href: `/nodes/${nodeId}` },
        { label: 'Terminal' }
      ]} />
      
      <div className="flex items-center gap-3 mb-6">
        <Terminal className="h-8 w-8" />
        <h1 className="text-3xl font-bold">Remote Terminal</h1>
        <Badge variant={connected ? 'default' : 'secondary'}>
          {connected ? '🟢 Connected' : '⚫ Disconnected'}
        </Badge>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Session Control</CardTitle>
            <div className="flex items-center gap-2">
              {!sessionId ? (
                <>
                  <select 
                    value={shell}
                    onChange={e => setShell(e.target.value as any)}
                    className="border rounded px-3 py-1.5 text-sm"
                  >
                    <option value="powershell">PowerShell</option>
                    <option value="cmd">CMD</option>
                    <option value="bash">Bash</option>
                  </select>
                  <Button onClick={startSession} disabled={loading}>
                    <Play className="h-4 w-4 mr-1" />
                    Start Session
                  </Button>
                </>
              ) : (
                <>
                  <Badge>{shell}</Badge>
                  <Button variant="destructive" onClick={stopSession}>
                    <Square className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                </>
              )}
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setOutput([])}
                title="Clear output"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Terminal Output */}
      <Card className="bg-black text-green-400 font-mono">
        <CardContent className="p-0">
          <div 
            ref={outputRef}
            className="h-[500px] overflow-y-auto p-4 whitespace-pre-wrap text-sm"
            onClick={() => inputRef.current?.focus()}
          >
            {output.length === 0 ? (
              <span className="text-gray-500">Click "Start Session" to begin...</span>
            ) : (
              output.map((line, i) => <span key={i}>{line}</span>)
            )}
          </div>
          
          {/* Input Line */}
          {sessionId && (
            <div className="border-t border-gray-700 p-2 flex items-center gap-2">
              <span className="text-green-400">{'>'}</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-green-400 outline-none"
                placeholder="Type command and press Enter..."
                autoFocus
              />
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground mt-4">
        ⚠️ Commands are executed on the remote node. Use with caution.
        Agent must support terminal polling (v0.4.28+).
      </p>
    </main>
  );
}
