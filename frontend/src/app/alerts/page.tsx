"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "openclaw-inventory-dev-key";

interface Alert {
  id: string;
  rule_name: string;
  event_type: string;
  severity: string;
  title: string;
  message: string;
  node_name: string | null;
  status: string;
  fired_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

interface AlertRule {
  id: string;
  name: string;
  description: string;
  event_type: string;
  severity: string;
  is_enabled: boolean;
  cooldown_minutes: number;
}

interface NotificationChannel {
  id: string;
  name: string;
  channel_type: string;
  is_enabled: boolean;
}

interface AlertStats {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  critical_active: number;
  warning_active: number;
  last_24h: number;
  last_7d: number;
}

const severityColors: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-yellow-500",
  info: "bg-blue-500",
};

const severityBadges: Record<string, string> = {
  critical: "bg-red-600 text-white",
  warning: "bg-yellow-600 text-black",
  info: "bg-blue-600 text-white",
};

const statusBadges: Record<string, string> = {
  fired: "bg-red-900 text-red-200 border border-red-700",
  acknowledged: "bg-yellow-900 text-yellow-200 border border-yellow-700",
  resolved: "bg-green-900 text-green-200 border border-green-700",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"alerts" | "rules" | "channels">("alerts");
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannel, setNewChannel] = useState({ name: "", channel_type: "discord", webhook_url: "" });

  const fetchData = async () => {
    try {
      const headers = { "X-API-Key": API_KEY };
      
      const [alertsRes, rulesRes, channelsRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/alerts?limit=50`, { headers }),
        fetch(`${API_URL}/api/v1/alerts/rules`, { headers }),
        fetch(`${API_URL}/api/v1/alerts/channels`, { headers }),
        fetch(`${API_URL}/api/v1/alerts/stats`, { headers }),
      ]);

      if (alertsRes.ok) setAlerts(await alertsRes.json());
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (channelsRes.ok) setChannels(await channelsRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (error) {
      console.error("Failed to fetch alerts data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await fetch(`${API_URL}/api/v1/alerts/${alertId}/acknowledge`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ by: "UI" }),
      });
      fetchData();
    } catch (error) {
      console.error("Failed to acknowledge alert:", error);
    }
  };

  const resolveAlert = async (alertId: string) => {
    try {
      await fetch(`${API_URL}/api/v1/alerts/${alertId}/resolve`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY },
      });
      fetchData();
    } catch (error) {
      console.error("Failed to resolve alert:", error);
    }
  };

  const toggleRule = async (ruleId: string, isEnabled: boolean) => {
    try {
      await fetch(`${API_URL}/api/v1/alerts/rules/${ruleId}`, {
        method: "PUT",
        headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: !isEnabled }),
      });
      fetchData();
    } catch (error) {
      console.error("Failed to toggle rule:", error);
    }
  };

  const testChannel = async (channelId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/alerts/channels/${channelId}/test`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY },
      });
      if (res.ok) {
        alert("Test notification sent!");
      } else {
        const data = await res.json();
        alert(`Test failed: ${data.detail || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Failed to test channel:", error);
      alert("Test failed: Network error");
    }
  };

  const addChannel = async () => {
    try {
      await fetch(`${API_URL}/api/v1/alerts/channels`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newChannel.name,
          channel_type: newChannel.channel_type,
          config: { webhook_url: newChannel.webhook_url },
        }),
      });
      setShowAddChannel(false);
      setNewChannel({ name: "", channel_type: "discord", webhook_url: "" });
      fetchData();
    } catch (error) {
      console.error("Failed to add channel:", error);
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!confirm("Delete this notification channel?")) return;
    try {
      await fetch(`${API_URL}/api/v1/alerts/channels/${channelId}`, {
        method: "DELETE",
        headers: { "X-API-Key": API_KEY },
      });
      fetchData();
    } catch (error) {
      console.error("Failed to delete channel:", error);
    }
  };

  const linkRuleToChannel = async (ruleId: string, channelId: string) => {
    try {
      await fetch(`${API_URL}/api/v1/alerts/rules/${ruleId}/channels/${channelId}`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY },
      });
      alert("Rule linked to channel!");
    } catch (error) {
      console.error("Failed to link:", error);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">🔔 Alerts</h1>
        <div className="animate-pulse bg-zinc-800 h-64 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">🔔 Alerts & Notifications</h1>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-red-500">{stats.critical_active}</div>
            <div className="text-zinc-400 text-sm">Critical Active</div>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-yellow-500">{stats.warning_active}</div>
            <div className="text-zinc-400 text-sm">Warnings Active</div>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-500">{stats.last_24h}</div>
            <div className="text-zinc-400 text-sm">Last 24h</div>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-zinc-400">{stats.resolved}</div>
            <div className="text-zinc-400 text-sm">Resolved</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-zinc-700 pb-2">
        {["alerts", "rules", "channels"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={`px-4 py-2 rounded-t-lg font-medium capitalize ${
              activeTab === tab
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            {tab === "alerts" && `Alerts (${alerts.length})`}
            {tab === "rules" && `Rules (${rules.length})`}
            {tab === "channels" && `Channels (${channels.length})`}
          </button>
        ))}
      </div>

      {/* Alerts Tab */}
      {activeTab === "alerts" && (
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <div className="bg-zinc-800 rounded-lg p-8 text-center text-zinc-400">
              <div className="text-4xl mb-2">✅</div>
              <div>No alerts - everything looks good!</div>
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className={`bg-zinc-800 rounded-lg p-4 border-l-4 ${severityColors[alert.severity] || "border-zinc-600"}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityBadges[alert.severity]}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ${statusBadges[alert.status]}`}>
                        {alert.status}
                      </span>
                      {alert.node_name && (
                        <span className="text-zinc-400 text-sm">📍 {alert.node_name}</span>
                      )}
                    </div>
                    <h3 className="font-semibold text-white">{alert.title}</h3>
                    <p className="text-zinc-400 text-sm mt-1">{alert.message}</p>
                    <div className="text-zinc-500 text-xs mt-2">
                      Fired: {new Date(alert.fired_at).toLocaleString()}
                      {alert.resolved_at && ` • Resolved: ${new Date(alert.resolved_at).toLocaleString()}`}
                    </div>
                  </div>
                  {alert.status === "fired" && (
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-sm"
                      >
                        Acknowledge
                      </button>
                      <button
                        onClick={() => resolveAlert(alert.id)}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                  {alert.status === "acknowledged" && (
                    <button
                      onClick={() => resolveAlert(alert.id)}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm ml-4"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Rules Tab */}
      {activeTab === "rules" && (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="bg-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white">{rule.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs ${severityBadges[rule.severity]}`}>
                      {rule.severity}
                    </span>
                    <span className="text-zinc-500 text-xs">({rule.event_type})</span>
                  </div>
                  <p className="text-zinc-400 text-sm mt-1">{rule.description}</p>
                  <p className="text-zinc-500 text-xs mt-1">Cooldown: {rule.cooldown_minutes} min</p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    className="bg-zinc-700 rounded px-2 py-1 text-sm"
                    onChange={(e) => e.target.value && linkRuleToChannel(rule.id, e.target.value)}
                    defaultValue=""
                  >
                    <option value="">Link to channel...</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name} ({ch.channel_type})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => toggleRule(rule.id, rule.is_enabled)}
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      rule.is_enabled
                        ? "bg-green-600 hover:bg-green-700"
                        : "bg-zinc-600 hover:bg-zinc-700"
                    }`}
                  >
                    {rule.is_enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Channels Tab */}
      {activeTab === "channels" && (
        <div className="space-y-3">
          <button
            onClick={() => setShowAddChannel(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium mb-4"
          >
            + Add Channel
          </button>

          {showAddChannel && (
            <div className="bg-zinc-800 rounded-lg p-4 mb-4 border border-zinc-600">
              <h3 className="font-semibold mb-3">Add Notification Channel</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Channel Name"
                  value={newChannel.name}
                  onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                  className="bg-zinc-700 rounded px-3 py-2"
                />
                <select
                  value={newChannel.channel_type}
                  onChange={(e) => setNewChannel({ ...newChannel, channel_type: e.target.value })}
                  className="bg-zinc-700 rounded px-3 py-2"
                >
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="teams">Microsoft Teams</option>
                  <option value="webhook">Generic Webhook</option>
                </select>
                <input
                  type="text"
                  placeholder="Webhook URL"
                  value={newChannel.webhook_url}
                  onChange={(e) => setNewChannel({ ...newChannel, webhook_url: e.target.value })}
                  className="bg-zinc-700 rounded px-3 py-2"
                />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={addChannel}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowAddChannel(false)}
                  className="px-4 py-2 bg-zinc-600 hover:bg-zinc-700 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {channels.length === 0 ? (
            <div className="bg-zinc-800 rounded-lg p-8 text-center text-zinc-400">
              <div className="text-4xl mb-2">📭</div>
              <div>No notification channels configured</div>
              <div className="text-sm mt-1">Add a Discord, Slack, or Teams webhook to receive alerts</div>
            </div>
          ) : (
            channels.map((channel) => (
              <div key={channel.id} className="bg-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">
                        {channel.channel_type === "discord" && "💬"}
                        {channel.channel_type === "slack" && "📨"}
                        {channel.channel_type === "teams" && "👥"}
                        {channel.channel_type === "webhook" && "🔗"}
                      </span>
                      <h3 className="font-semibold text-white">{channel.name}</h3>
                      <span className="text-zinc-500 text-sm capitalize">({channel.channel_type})</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => testChannel(channel.id)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => deleteChannel(channel.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
