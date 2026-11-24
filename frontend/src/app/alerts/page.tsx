"use client";
import { apiClient } from "@/lib/api-client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell, Plus, Trash2, TestTube, Check, X } from "lucide-react";
import { StandardPage } from "@/components/ui/StandardPage";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format";



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

// The label is alertsPage.events.<value>
const EVENT_TYPES = [
  { value: 'node_offline', icon: '🔴' },
  { value: 'node_online', icon: '🟢' },
  { value: 'job_failed', icon: '❌' },
  { value: 'job_success', icon: '✅' },
  { value: 'disk_warning', icon: '💾' },
  { value: 'vulnerability_critical', icon: '🛡️' },
];

const HISTORY_STATUSES = ['sent', 'failed', 'throttled'];

export default function AlertsPage() {
  const { t } = useI18n();
  const eventName = (type: string) =>
    EVENT_TYPES.some(e => e.value === type) ? t(`alertsPage.events.${type}`) : type.replace('_', ' ');
  const eventLabel = (type: string) => {
    const et = EVENT_TYPES.find(e => e.value === type);
    return et ? `${et.icon} ${t(`alertsPage.events.${type}`)}` : type;
  };
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
        apiClient.get<AlertChannel[]>(`/alert-channels`, { showErrorToast: false }),
        apiClient.get<AlertRule[]>(`/alert-rules`, { showErrorToast: false }),
        apiClient.get<AlertHistoryEntry[]>(`/alert-history?limit=20`, { showErrorToast: false }),
      ]);
      
      if (channelsRes) setChannels(channelsRes);
      if (rulesRes) setRules(rulesRes);
      if (historyRes) setHistory(historyRes);
    } catch (e) {
      console.error('Failed to fetch alerts:', e);
    }
    setLoading(false);
  }

  async function createChannel() {
    const token = localStorage.getItem('token');
    const res = await apiClient.post(`/alert-channels`, {
        name: newChannelName,
        channel_type: 'discord',
        config: { webhook_url: newWebhookUrl },
        enabled: true
      }, { showErrorToast: false });
    if (res) {
      setShowNewChannel(false);
      setNewChannelName('');
      setNewWebhookUrl('');
      fetchData();
    }
  }

  async function createRule() {
    const token = localStorage.getItem('token');
    const res = await apiClient.post(`/alert-rules`, {
        name: newRuleName,
        event_type: newRuleEvent,
        channel_id: newRuleChannel,
        cooldown_minutes: 15,
        enabled: true
      }, { showErrorToast: false });
    if (res) {
      setShowNewRule(false);
      setNewRuleName('');
      fetchData();
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm(t("alertsPage.deleteChannelConfirm"))) return;
    const token = localStorage.getItem('token');
    await apiClient.delete(`/alert-channels/${id}`, { showErrorToast: false });
    fetchData();
  }

  async function deleteRule(id: string) {
    if (!confirm(t("alertsPage.deleteRuleConfirm"))) return;
    const token = localStorage.getItem('token');
    await apiClient.delete(`/alert-rules/${id}`, { showErrorToast: false });
    fetchData();
  }

  async function testChannel(id: string) {
    const token = localStorage.getItem('token');
    const data = await apiClient.post<{ status: string }>(`/alert-channels/${id}/test`, {}, { showErrorToast: false });
    alert(data?.status === 'sent' ? `✅ ${t("alertsPage.testSent")}` : `❌ ${t("alertsPage.testFailed")}`);
  }

  return (
    <StandardPage
      title={t("alertsPage.title")}
      icon={<Bell className="h-6 w-6" />}
      loading={loading}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Channels */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>📡 {t("alertsPage.channels")}</CardTitle>
                <CardDescription>{t("alertsPage.channelsText")}</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowNewChannel(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("alertsPage.addDiscord")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewChannel && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <Input 
                  placeholder={t("alertsPage.channelNamePlaceholder")} 
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                />
                <Input 
                  placeholder={t("alertsPage.webhookPlaceholder")} 
                  value={newWebhookUrl}
                  onChange={e => setNewWebhookUrl(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={createChannel} disabled={!newChannelName || !newWebhookUrl}>
                    {t("common.create")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewChannel(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}
            
            {channels.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">{t("alertsPage.noChannels")}</p>
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
                        {ch.enabled ? t("common.active") : t("alertsPage.disabled")}
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
                <CardTitle>📋 {t("alertsPage.rules")}</CardTitle>
                <CardDescription>{t("alertsPage.rulesText")}</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowNewRule(true)} disabled={channels.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> {t("alertsPage.addRule")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewRule && (
              <div className="mb-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <Input 
                  placeholder={t("alertsPage.ruleNamePlaceholder")} 
                  value={newRuleName}
                  onChange={e => setNewRuleName(e.target.value)}
                />
                <select 
                  className="w-full border rounded px-3 py-2"
                  value={newRuleEvent}
                  onChange={e => setNewRuleEvent(e.target.value)}
                >
                  {EVENT_TYPES.map(et => (
                    <option key={et.value} value={et.value}>{eventLabel(et.value)}</option>
                  ))}
                </select>
                <select 
                  className="w-full border rounded px-3 py-2"
                  value={newRuleChannel}
                  onChange={e => setNewRuleChannel(e.target.value)}
                >
                  <option value="">{t("alertsPage.selectChannel")}</option>
                  {channels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button size="sm" onClick={createRule} disabled={!newRuleName || !newRuleChannel}>
                    {t("common.create")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewRule(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}
            
            {rules.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">{t("alertsPage.noRules")}</p>
            ) : (
              <div className="space-y-2">
                {rules.map(rule => (
                  <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{rule.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {eventLabel(rule.event_type)}
                        {' → '}{rule.channel_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                        {rule.enabled ? t("common.active") : t("alertsPage.disabled")}
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
          <CardTitle>📜 {t("alertsPage.history")}</CardTitle>
          <CardDescription>{t("alertsPage.historyText")}</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">{t("alertsPage.noHistory")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("alertsPage.columns.time")}</TableHead>
                  <TableHead>{t("alertsPage.columns.event")}</TableHead>
                  <TableHead>{t("alertsPage.columns.rule")}</TableHead>
                  <TableHead>{t("alertsPage.columns.channel")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(h.created_at)}
                    </TableCell>
                    <TableCell>{eventName(h.event_type)}</TableCell>
                    <TableCell>{h.rule_name || '-'}</TableCell>
                    <TableCell>{h.channel_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={h.status === 'sent' ? 'default' : h.status === 'throttled' ? 'secondary' : 'destructive'}>
                        {h.status === 'sent' && <Check className="h-3 w-3 mr-1" />}
                        {h.status === 'failed' && <X className="h-3 w-3 mr-1" />}
                        {HISTORY_STATUSES.includes(h.status) ? t(`alertsPage.status.${h.status}`) : h.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </StandardPage>
  );
}
