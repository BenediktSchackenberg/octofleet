"use client";

import { useState } from "react";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "openclaw-inventory-dev-key";

type ExportType = "nodes" | "software" | "compliance";

interface ExportButtonsProps {
  type: ExportType;
  className?: string;
}

export function ExportButtons({ type, className = "" }: ExportButtonsProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: "json" | "csv") {
    setExporting(true);
    try {
      const url = `${API_URL}/api/v1/export/${type}?format=${format}`;
      
      if (format === "csv") {
        // Direct download for CSV
        window.open(url, "_blank");
      } else {
        // Fetch and download JSON
        const res = await fetch(url, {
          headers: { "X-API-Key": API_KEY }
        });
        
        if (res.ok) {
          const data = await res.json();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = downloadUrl;
          a.download = `${type}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(downloadUrl);
        }
      }
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      <button
        onClick={() => handleExport("csv")}
        disabled={exporting}
        className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded text-sm disabled:opacity-50"
        title="Export as CSV"
      >
        <FileSpreadsheet className="h-4 w-4" />
        CSV
      </button>
      <button
        onClick={() => handleExport("json")}
        disabled={exporting}
        className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded text-sm disabled:opacity-50"
        title="Export as JSON"
      >
        <FileJson className="h-4 w-4" />
        JSON
      </button>
    </div>
  );
}

// Quick export dropdown for nav/header
export function ExportDropdown() {
  const [open, setOpen] = useState(false);

  const exports: { type: ExportType; label: string; icon: string }[] = [
    { type: "nodes", label: "Nodes", icon: "🖥️" },
    { type: "software", label: "Software", icon: "📦" },
    { type: "compliance", label: "Compliance", icon: "🛡️" },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/80 rounded text-sm"
      >
        <Download className="h-4 w-4" />
        Export
      </button>
      
      {open && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg min-w-48">
            <div className="p-2">
              <p className="text-xs text-muted-foreground px-2 py-1">Export Data</p>
              {exports.map((exp) => (
                <div key={exp.type} className="py-1">
                  <div className="px-2 py-1 text-sm font-medium flex items-center gap-2">
                    {exp.icon} {exp.label}
                  </div>
                  <div className="flex gap-1 px-2">
                    <a
                      href={`${API_URL}/api/v1/export/${exp.type}?format=csv`}
                      target="_blank"
                      className="flex-1 text-center px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded"
                      onClick={() => setOpen(false)}
                    >
                      CSV
                    </a>
                    <a
                      href={`${API_URL}/api/v1/export/${exp.type}?format=json`}
                      target="_blank"
                      className="flex-1 text-center px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded"
                      onClick={() => setOpen(false)}
                    >
                      JSON
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
