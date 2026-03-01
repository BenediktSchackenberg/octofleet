"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import Link from "next/link";

interface Alert {
  id: string;
  event_type: string;
  message: string;
  severity?: string;
  sent_at: string;
  node_id?: string;
  hostname?: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function severityIcon(alert: Alert) {
  const type = alert.severity || alert.event_type;
  if (type?.includes("critical") || type?.includes("offline")) return <AlertCircle className="h-4 w-4 text-red-400" />;
  if (type?.includes("warning") || type?.includes("failed")) return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
  if (type?.includes("online") || type?.includes("success")) return <CheckCircle className="h-4 w-4 text-green-400" />;
  return <Info className="h-4 w-4 text-blue-400" />;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [hasNew, setHasNew] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const stored = localStorage.getItem("octofleet-read-alerts");
    if (stored) {
      try { setReadIds(new Set(JSON.parse(stored))); } catch {}
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function fetchAlerts() {
    const data = await apiClient.get<Alert[]>("/alert-history?limit=10", { showErrorToast: false });
    if (data) {
      if (prevCountRef.current > 0 && data.length > prevCountRef.current) {
        setHasNew(true);
      }
      prevCountRef.current = data.length;
      setAlerts(data);
    }
  }

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000);
    return () => clearInterval(interval);
  }, []);

  function handleOpen() {
    setOpen(!open);
    setHasNew(false);
    if (!open) fetchAlerts();
  }

  function markAllRead() {
    const ids = new Set(alerts.map(a => a.id));
    setReadIds(ids);
    localStorage.setItem("octofleet-read-alerts", JSON.stringify([...ids]));
  }

  const unreadCount = alerts.filter(a => !readIds.has(a.id)).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 text-zinc-400 hover:text-white transition-colors"
      >
        <Bell className={`h-4 w-4 ${hasNew ? "animate-pulse text-yellow-400" : ""}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <span className="text-sm font-semibold text-zinc-100">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-blue-400 hover:text-blue-300">
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">No notifications</div>
              ) : (
                alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors ${
                      readIds.has(alert.id) ? "opacity-60" : ""
                    }`}
                  >
                    <div className="mt-0.5">{severityIcon(alert)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 truncate">{alert.message || alert.event_type}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{timeAgo(alert.sent_at)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <Link
              href="/alerts"
              onClick={() => setOpen(false)}
              className="block text-center py-2.5 text-xs font-medium text-blue-400 hover:bg-zinc-800/50 border-t border-zinc-800 transition-colors"
            >
              View all alerts →
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
