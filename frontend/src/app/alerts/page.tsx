"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { Bell, Plus, Trash2, TestTube, Check, X } from "lucide-react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080') + '/api/v1';

interface AlertChannel {
  id: string;
  name: string;
  channel_type: string;
  config: { webhook_url?: string };
  enabled: boolean;
  created_at: string;
}

interface AlertRule {
  id: string;
  name: string;
  event_type: string;
  channel_id: string;
  channel_name: string;
  cooldown_minutes: number;
  enabled: boolean;
}

interface AlertHistoryEntry {
  id: string;
  rule_name: string;
  channel_name: string;
  event_type: string;
  event_data: any;
  status: string;
  created_at: string;
}

const EVENT_TYPES = [
  { value: 'node_offline', label: '🔴 Node Offline' },
  { value: 'node_online', label: '🟢 Node Online' },
  { value: 'job_failed', label: '❌ Job Failed' },
  { value: 'job_success', label: '✅ Job Success' },
  { value: 'disk_warning', label: '💾 Disk Warning' },
  { value: 'vulnerability_critical', label: '🛡️ Critical Vulnerability' },
];

export default function AlertsPage() {
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New channel form
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  
  // New rule form
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleEvent, setNewRuleEvent] = useState('job_failed');
  const [newRuleChannel, setNewRuleChannel] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    
    try {
      const [channelsRes, rulesRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/alert-channels`, { headers }),
        fetch(`${API_BASE}/alert-rules`, { headers }),
        fetch(`${API_BASE}/alert-history?limit=20`, { headers }),
      ]);
      
      if (channelsRes.ok) setChannels(await channelsRes.json());
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (historyRes.ok) setHistory(await historyRes.json());
    } catch (e) {
      console.error('Failed to fetch alerts:', e);
    }
    setLoading(false);
  }

  async function createChannel() {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/alert-channels`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: newChannelName,
        channel_type: 'discord',
        config: { webhook_url: newWebhookUrl },
        enabled: true
      })
    });
    if (res.ok) {
      setShowNewChannel(false);
      setNewChannelName('');
      setNewWebhookUrl('');
      fetchData();
    }
  }

  async function createRule() {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/alert-rules`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: newRuleName,
        event_type: newRuleEvent,
        channel_id: newRuleChannel,
        cooldown_minutes: 15,
        enabled: true
      })
    });
    if (res.ok) {
      setShowNewRule(false);
      setNewRuleName('');
      fetchData();
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm('Delete this channel?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE}/alert-channels/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchData();
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE}/alert-rules/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchData();
  }

  async function testChannel(id: string) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/alert-channels/${id}/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    alert(data.status === 'sent' ? '✅ Test sent!' : '❌ Test failed');
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/' }, { label: 'Alerts' }]} />
      
      <div className="flex items-center gap-3 mb-8">
        <Bell className="h-8 w-8" />
        <h1 className="text-3xl font-bold">Alerts</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Channels */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>📡 Channels</CardTitle>
                <CardDescription>Where alerts are sent</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowNewChannel(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Discord
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewChannel && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <Input 
                  placeholder="Channel Name (e.g. #alerts)" 
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                />
                <Input 
                  placeholder="Discord Webhook URL" 
                  value={newWebhookUrl}
                  onChange={e => setNewWebhookUrl(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={createChannel} disabled={!newChannelName || !newWebhookUrl}>
                    Create
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewChannel(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            
            {channels.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No channels configured</p>
            ) : (
              <div className="space-y-2">
                {channels.map(ch => (
                  <div key={ch.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🎮</span>
                      <div>
                        <p className="font-medium">{ch.name}</p>
                        <p className="text-xs text-muted-foreground">{ch.channel_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={ch.enabled ? 'default' : 'secondary'}>
                        {ch.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                      <Button size="icon" variant="ghost" onClick={() => testChannel(ch.id)}>
                        <TestTube className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteChannel(ch.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rules */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>📋 Rules</CardTitle>
                <CardDescription>When to send alerts</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowNewRule(true)} disabled={channels.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> Add Rule
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewRule && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <Input 
                  placeholder="Rule Name" 
                  value={newRuleName}
                  onChange={e => setNewRuleName(e.target.value)}
                />
                <select 
                  className="w-full border rounded px-3 py-2"
                  value={newRuleEvent}
                  onChange={e => setNewRuleEvent(e.target.value)}
                >
                  {EVENT_TYPES.map(et => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </select>
                <select 
                  className="w-full border rounded px-3 py-2"
                  value={newRuleChannel}
                  onChange={e => setNewRuleChannel(e.target.value)}
                >
                  <option value="">Select Channel...</option>
                  {channels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button size="sm" onClick={createRule} disabled={!newRuleName || !newRuleChannel}>
                    Create
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewRule(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            
            {rules.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No rules configured</p>
            ) : (
              <div className="space-y-2">
                {rules.map(rule => (
                  <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{rule.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {EVENT_TYPES.find(e => e.value === rule.event_type)?.label || rule.event_type}
                        {' → '}{rule.channel_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                        {rule.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                      <Button size="icon" variant="ghost" onClick={() => deleteRule(rule.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>📜 Alert History</CardTitle>
          <CardDescription>Recent alerts sent</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No alerts sent yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{h.event_type.replace('_', ' ')}</TableCell>
                    <TableCell>{h.rule_name || '-'}</TableCell>
                    <TableCell>{h.channel_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={h.status === 'sent' ? 'default' : h.status === 'throttled' ? 'secondary' : 'destructive'}>
                        {h.status === 'sent' && <Check className="h-3 w-3 mr-1" />}
                        {h.status === 'failed' && <X className="h-3 w-3 mr-1" />}
                        {h.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
