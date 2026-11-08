"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { API_URL } from "@/lib/api-config";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n-context";

export function LiveEventToast() {
  const { isAdmin, token } = useAuth();
  const sourceRef = useRef<EventSource | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!isAdmin() || !token) return;

    const url = `${API_URL}/api/v1/admin/agent-live?token=${token}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "heartbeat" || data.type === "ping") return;

        const evType = data.event_type || data.type || "";
        const msg = data.message || data.hostname || evType;

        if (evType.includes("online")) {
          toast.success(t("widgets.live.agentOnline"), { description: msg, duration: 4000 });
        } else if (evType.includes("offline")) {
          toast.error(t("widgets.live.agentOffline"), { description: msg, duration: 5000 });
        } else if (evType.includes("job_complete") || evType.includes("job_success")) {
          toast.success(t("widgets.live.jobCompleted"), { description: msg, duration: 4000 });
        } else if (evType.includes("critical") || evType.includes("alert")) {
          toast.error(t("widgets.live.criticalAlert"), { description: msg, duration: 6000 });
        }
      } catch {}
    };

    source.onerror = () => {
      source.close();
      // Reconnect after 30s
      setTimeout(() => {
        if (sourceRef.current === source) {
          sourceRef.current = null;
        }
      }, 30000);
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [isAdmin, token]);

  return null;
}
