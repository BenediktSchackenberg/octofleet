"use client";

import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, Table2 } from "lucide-react";
import { getAuthHeader } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

type ExportType = "nodes" | "software" | "compliance" | "vulnerabilities" | "jobs";

interface ExportButtonsProps {
  type: ExportType;
  className?: string;
  showExcel?: boolean;
}

export function ExportButtons({ type, className = "", showExcel = true }: ExportButtonsProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: "json" | "csv" | "excel") {
    setExporting(true);
    try {
      if (format === "excel") {
        // Download Excel file
        const url = `${API_URL}/api/v1/export/${type}/excel`;
        const res = await fetch(url, {
          headers: getAuthHeader()
        });
        
        if (res.ok) {
          const blob = await res.blob();
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = downloadUrl;
          a.download = `${type}_${new Date().toISOString().split('T')[0]}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(downloadUrl);
        }
      } else if (format === "csv") {
        // Direct download for CSV
        const url = `${API_URL}/api/v1/export/${type}?format=${format}`;
        window.open(url, "_blank");
      } else {
        // Fetch and download JSON
        const url = `${API_URL}/api/v1/export/${type}?format=${format}`;
        const res = await fetch(url, {
          headers: getAuthHeader()
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
      {showExcel && (
        <button
          onClick={() => handleExport("excel")}
          disabled={exporting}
          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm disabled:opacity-50"
          title="Export as Excel"
        >
          <Table2 className="h-4 w-4" />
          Excel
        </button>
      )}
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
  const [exporting, setExporting] = useState<string | null>(null);

  const exports: { type: ExportType; label: string; icon: string; hasExcel: boolean }[] = [
    { type: "nodes", label: "Nodes", icon: "🖥️", hasExcel: true },
    { type: "software", label: "Software", icon: "📦", hasExcel: true },
    { type: "vulnerabilities", label: "Vulnerabilities", icon: "🔓", hasExcel: true },
    { type: "jobs", label: "Jobs (30d)", icon: "📋", hasExcel: true },
    { type: "compliance", label: "Compliance", icon: "🛡️", hasExcel: false },
  ];

  async function downloadExcel(type: string) {
    setExporting(type);
    try {
      const res = await fetch(`${API_URL}/api/v1/export/${type}/excel`, {
        headers: getAuthHeader()
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("Excel export failed:", e);
    } finally {
      setExporting(null);
    }
  }

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
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg min-w-56">
            <div className="p-2">
              <p className="text-xs text-muted-foreground px-2 py-1">Export Data</p>
              {exports.map((exp) => (
                <div key={exp.type} className="py-1">
                  <div className="px-2 py-1 text-sm font-medium flex items-center gap-2">
                    {exp.icon} {exp.label}
                  </div>
                  <div className="flex gap-1 px-2">
                    {exp.hasExcel && (
                      <button
                        onClick={() => downloadExcel(exp.type)}
                        disabled={exporting === exp.type}
                        className="flex-1 text-center px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                      >
                        {exporting === exp.type ? "..." : "Excel"}
                      </button>
                    )}
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
