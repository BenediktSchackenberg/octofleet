import { apiClient } from "@/lib/api-client";
"use client";

import { useState } from "react";
import { FileText, Download, Calendar, Loader2, Shield, Server, Package, CheckCircle, AlertCircle } from "lucide-react";
import { getAuthHeader, useAuth } from "@/lib/auth-context";
import { API_URL } from '@/lib/api-config';



interface ReportConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  supportsDateRange: boolean;
  formats: ("pdf" | "excel")[];
}

const REPORTS: ReportConfig[] = [
  {
    id: "fleet",
    name: "Fleet Summary",
    description: "Overview of all nodes, health status, and performance metrics",
    icon: <Server className="h-6 w-6" />,
    endpoint: "/api/v1/reports/fleet/pdf",
    supportsDateRange: false,
    formats: ["pdf"],
  },
  {
    id: "security",
    name: "Security Report",
    description: "Vulnerabilities, CVEs, and compliance status across your fleet",
    icon: <Shield className="h-6 w-6" />,
    endpoint: "/api/v1/reports/security/pdf",
    supportsDateRange: false,
    formats: ["pdf"],
  },
  {
    id: "inventory",
    name: "Inventory Report",
    description: "Hardware and software inventory for all nodes",
    icon: <Package className="h-6 w-6" />,
    endpoint: "/api/v1/reports/inventory/pdf",
    supportsDateRange: false,
    formats: ["pdf"],
  },
];

export default function ReportsPage() {
  const { user, token } = useAuth();
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [recentDownloads, setRecentDownloads] = useState<{ name: string; time: Date }[]>([]);

  async function generateReport(report: ReportConfig) {
    if (!token) {
      setError("Please log in to generate reports");
      return;
    }
    setError(null);
    setGenerating(report.id);
    try {
      let url = `${API_URL}${report.endpoint}`;
      if (report.supportsDateRange) {
        url += `?from=${dateFrom}&to=${dateTo}`;
      }

      const res = await fetch(url, {
        headers: getAuthHeader(),
      });

      if (res.ok) {
        const blob = await res.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        
        // Get filename from Content-Disposition header or generate one
        const disposition = res.headers.get("Content-Disposition");
        let filename = `${report.id}_report_${new Date().toISOString().split("T")[0]}.pdf`;
        if (disposition) {
          const match = disposition.match(/filename=([^;]+)/);
          if (match) filename = match[1].replace(/"/g, "");
        }
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        // Track download
        setRecentDownloads((prev) => [{ name: report.name, time: new Date() }, ...prev.slice(0, 4)]);
      } else {
        const err = await res.text();
        console.error("Report generation failed:", err);
        if (res.status === 401) {
          setError("Authentication failed. Please log in again.");
        } else {
          setError(`Failed to generate report: ${res.status} - ${err}`);
        }
      }
    } catch (e) {
      console.error("Report generation error:", e);
      setError("Failed to generate report. Check console for details.");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="container mx-auto px-4 py-6">
<div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Report Generator
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate PDF reports for fleet overview, security audits, and inventory documentation
          </p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p>{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-sm underline">Dismiss</button>
        </div>
      )}

      {/* Not logged in warning */}
      {!token && (
        <div className="bg-yellow-500/10 border border-yellow-500/50 text-yellow-600 dark:text-yellow-400 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p>You need to be logged in to generate reports. <a href="/login" className="underline font-medium">Log in</a></p>
        </div>
      )}

      {/* Date Range Picker */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Date Range</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">From:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-1.5 bg-background border border-input rounded text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">To:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-1.5 bg-background border border-input rounded text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                setDateFrom(d.toISOString().split("T")[0]);
                setDateTo(new Date().toISOString().split("T")[0]);
              }}
              className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded"
            >
              Last 7 days
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                setDateFrom(d.toISOString().split("T")[0]);
                setDateTo(new Date().toISOString().split("T")[0]);
              }}
              className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded"
            >
              Last 30 days
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 90);
                setDateFrom(d.toISOString().split("T")[0]);
                setDateTo(new Date().toISOString().split("T")[0]);
              }}
              className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded"
            >
              Last 90 days
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Note: Date range currently applies to job history reports. Fleet and security reports show current state.
        </p>
      </div>

      {/* Report Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <div
            key={report.id}
            className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-colors"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary/10 text-primary rounded-lg">{report.icon}</div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{report.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{report.description}</p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {report.formats.includes("pdf") && (
                <button
                  onClick={() => generateReport(report)}
                  disabled={generating === report.id}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm disabled:opacity-50"
                >
                  {generating === report.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download PDF
                    </>
                  )}
                </button>
              )}
            </div>

            {report.supportsDateRange && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Uses selected date range
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Data Exports Section */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Data Exports</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Export raw data as Excel, CSV, or JSON for further analysis
        </p>
        
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            { type: "nodes", label: "Nodes", icon: "🖥️" },
            { type: "software", label: "Software", icon: "📦" },
            { type: "vulnerabilities", label: "Vulnerabilities", icon: "🔓" },
            { type: "jobs", label: "Jobs (30d)", icon: "📋" },
          ].map((exp) => (
            <div key={exp.type} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{exp.icon}</span>
                <span className="font-medium">{exp.label}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const res = await apiClient.get(`/export/${exp.type}/excel`, { showErrorToast: false });
                    if (res.ok) {
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${exp.type}_${new Date().toISOString().split("T")[0]}.xlsx`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }
                  }}
                  className="flex-1 px-2 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Excel
                </button>
                <a
                  href={`${API_URL}/api/v1/export/${exp.type}?format=csv`}
                  target="_blank"
                  className="flex-1 text-center px-2 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded"
                >
                  CSV
                </a>
                <a
                  href={`${API_URL}/api/v1/export/${exp.type}?format=json`}
                  target="_blank"
                  className="flex-1 text-center px-2 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded"
                >
                  JSON
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Downloads */}
      {recentDownloads.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Recent Downloads</h2>
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {recentDownloads.map((dl, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-medium">{dl.name}</span>
                <span className="text-sm text-muted-foreground ml-auto">
                  {dl.time.toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
