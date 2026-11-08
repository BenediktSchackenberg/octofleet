"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";

const shortcuts = [
  { keys: ["Ctrl", "K"], descriptionKey: "shortcuts.quickSearch" },
  { keys: ["G", "D"], descriptionKey: "shortcuts.goDashboard" },
  { keys: ["G", "N"], descriptionKey: "shortcuts.goNodes" },
  { keys: ["G", "J"], descriptionKey: "shortcuts.goJobs" },
  { keys: ["G", "A"], descriptionKey: "shortcuts.goAlerts" },
  { keys: ["?"], descriptionKey: "shortcuts.thisDialog" },
];

const goRoutes: Record<string, string> = {
  d: "/",
  n: "/nodes",
  j: "/jobs",
  a: "/alerts",
};

export function KeyboardShortcuts() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  const router = useRouter();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

    if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setOpen(o => !o);
      return;
    }

    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) {
      setGPressed(true);
      setTimeout(() => setGPressed(false), 1000);
      return;
    }

    if (gPressed) {
      const route = goRoutes[e.key.toLowerCase()];
      if (route) {
        e.preventDefault();
        router.push(route);
        setGPressed(false);
      }
    }
  }, [gPressed, router]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[420px] max-w-[90vw] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-bold text-zinc-100">{t("shortcuts.title")}</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {shortcuts.map(s => (
                <div key={s.descriptionKey} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">{t(s.descriptionKey)}</span>
                  <div className="flex gap-1">
                    {s.keys.map(k => (
                      <kbd
                        key={k}
                        className="px-2 py-1 text-[11px] font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-300"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
