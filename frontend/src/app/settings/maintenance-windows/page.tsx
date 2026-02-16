"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getAuthHeader } from "@/lib/auth-context";
import { Breadcrumb } from "@/components/ui-components";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface MaintenanceWindow {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  timezone: string;
  is_active: boolean;
  target_type: string;
  target_id: string | null;
}

const dayNames = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function CreateWindowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("22:00");
  const [endTime, setEndTime] = useState("06:00");
  const [daysOfWeek, setDaysOfWeek] = useState([1, 2, 3, 4, 5]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/v1/maintenance-windows`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          name,
          description: description || null,
          startTime,
          endTime,
          daysOfWeek,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Fehler beim Erstellen");
      }

      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">🕐 Wartungsfenster erstellen</h2>

        {error && (
          <div className="mb-4 rounded bg-red-500/20 p-3 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Nachtfenster"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Beschreibung</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional..."
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400">Startzeit</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">Endzeit</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Wochentage</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`w-10 h-10 rounded font-medium ${
                    daysOfWeek.includes(day)
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
                  }`}
                >
                  {dayNames[day]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500">
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading || !name}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Erstelle..." : "Erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MaintenanceWindowsPage() {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchWindows = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/maintenance-windows`, {
        headers: getAuthHeader(),
      });
      const data = await res.json();
      setWindows(data.windows || []);
    } catch (err) {
      console.error("Failed to fetch windows:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await fetch(`${API_URL}/api/v1/maintenance-windows/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchWindows();
  };

  const deleteWindow = async (id: string) => {
    if (!confirm("Wartungsfenster wirklich löschen?")) return;
    await fetch(`${API_URL}/api/v1/maintenance-windows/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    fetchWindows();
  };

  useEffect(() => {
    fetchWindows();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-900 p-6">
      <div className="mx-auto max-w-5xl">
        <Breadcrumb items={[
          { label: "Home", href: "/" },
          { label: "Einstellungen", href: "/settings" },
          { label: "Wartungsfenster" }
        ]} />

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">🕐 Wartungsfenster</h1>
            <p className="text-zinc-400">Deployments nur in definierten Zeitfenstern ausführen</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
          >
            + Neues Fenster
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-zinc-400">Lade...</div>
        ) : windows.length === 0 ? (
          <div className="rounded-lg bg-zinc-800 p-12 text-center">
            <div className="text-6xl mb-4">🕐</div>
            <h2 className="text-xl font-semibold text-white mb-2">Keine Wartungsfenster</h2>
            <p className="text-zinc-400 mb-4">
              Erstelle Zeitfenster, in denen Deployments ausgeführt werden dürfen.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-500"
            >
              Erstes Fenster erstellen
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {windows.map((w) => (
              <div key={w.id} className="rounded-lg bg-zinc-800 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${w.is_active ? "bg-green-500" : "bg-zinc-500"}`} />
                    <div>
                      <h3 className="font-medium text-white">{w.name}</h3>
                      <p className="text-sm text-zinc-400">
                        {w.start_time} - {w.end_time} Uhr
                        <span className="mx-2">•</span>
                        {w.days_of_week.map(d => dayNames[d]).join(", ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleActive(w.id, w.is_active)}
                      className={`rounded px-3 py-1 text-sm ${
                        w.is_active 
                          ? "bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30"
                          : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                      }`}
                    >
                      {w.is_active ? "Deaktivieren" : "Aktivieren"}
                    </button>
                    <button
                      onClick={() => deleteWindow(w.id)}
                      className="rounded px-3 py-1 text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30"
                    >
                      Löschen
                    </button>
                  </div>
                </div>
                {w.description && (
                  <p className="mt-2 text-sm text-zinc-400 ml-7">{w.description}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 rounded-lg bg-zinc-800/50 p-4">
          <h3 className="font-medium text-zinc-300 mb-2">💡 Tipp</h3>
          <p className="text-sm text-zinc-400">
            Aktiviere "Nur in Wartungsfenster" bei Deployments, um sicherzustellen, dass Installationen 
            nur während der definierten Zeiten stattfinden. Ideal für Server oder kritische Systeme.
          </p>
        </div>
      </div>

      {showCreate && (
        <CreateWindowDialog onClose={() => setShowCreate(false)} onCreated={fetchWindows} />
      )}
    </div>
  );
}
