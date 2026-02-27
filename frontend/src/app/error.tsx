"use client";

import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 sm:p-12">
      <div className="max-w-xl w-full bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-destructive/10 rounded-full">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Systemfehler aufgetreten</h2>
              <p className="text-muted-foreground">Ein unerwarteter Fehler ist aufgetreten.</p>
            </div>
          </div>
          
          <div className="bg-muted/50 rounded-lg p-4 mb-8 border border-border/50">
            <p className="text-sm font-mono text-muted-foreground break-words overflow-auto max-h-40">
              {error.message || "Unbekannter Fehler"}
              {error.digest && <span className="block mt-2 opacity-50">ID: {error.digest}</span>}
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={reset}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:opacity-90 transition-all active:scale-[0.98]"
            >
              <RefreshCw className="w-4 h-4" />
              Erneut versuchen
            </button>
            <Link
              href="/"
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-secondary text-secondary-foreground font-semibold rounded-lg hover:bg-secondary/80 transition-all"
            >
              <Home className="w-4 h-4" />
              Zum Dashboard
            </Link>
          </div>
        </div>
        <div className="bg-muted/30 px-8 py-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
          <span>Octofleet QA System</span>
          <span>Build 2026.02</span>
        </div>
      </div>
    </div>
  );
}
