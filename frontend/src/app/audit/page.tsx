"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { getAuthHeader } from "@/lib/auth-context";
import { Search, Filter, RefreshCw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: any;
  ip_address: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  "login": "bg-green-500/20 text-green-400",
  "logout": "bg-zinc-500/20 text-zinc-400",
  "create": "bg-blue-500/20 text-blue-400",
  "update": "bg-yellow-500/20 text-yellow-400",
  "delete": "bg-red-500/20 text-red-400",
  "deploy": "bg-purple-500/20 text-purple-400",
  "execute": "bg-orange-500/20 text-orange-400",
};

function getActionColor(action: string): string {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.toLowerCase().includes(key)) return color;
  }
  return "bg-zinc-500/20 text-zinc-400";
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ action: "", resource_type: "" });
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    fetchAudit();
  }, [page, filter]);

  async function fetchAudit() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (filter.action) params.set("action", filter.action);
      if (filter.resource_type) params.set("resource_type", filter.resource_type);

      const res = await fetch(`${API_URL}/api/v1/audit?${params}`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Failed to fetch audit log:", e);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="min-h-screen bg-background p-6">
      <Breadcrumb items={[{ label: "Audit Log" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📜 Audit Log</h1>
          <p className="text-muted-foreground">{total} entries</p>
        </div>
        <button
          onClick={fetchAudit}
          className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/80 rounded text-sm"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Action Filter</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={filter.action}
                  onChange={(e) => setFilter({ ...filter, action: e.target.value })}
                  placeholder="e.g. login, create, delete..."
                  className="w-full pl-10 pr-4 py-2 bg-secondary border border-input rounded-md"
                />
              </div>
            </div>
            <div className="w-48">
              <label className="text-sm font-medium mb-1 block">Resource Type</label>
              <select
                value={filter.resource_type}
                onChange={(e) => setFilter({ ...filter, resource_type: e.target.value })}
                className="w-full px-3 py-2 bg-secondary border border-input rounded-md"
              >
                <option value="">All</option>
                <option value="user">User</option>
                <option value="node">Node</option>
                <option value="job">Job</option>
                <option value="package">Package</option>
                <option value="deployment">Deployment</option>
                <option value="group">Group</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No audit entries found</p>
              <p className="text-sm mt-2">Actions will be logged as users interact with the system</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {formatDate(entry.timestamp)}
                      </TableCell>
                      <TableCell>
                        {entry.username || (
                          <span className="text-muted-foreground">System</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={getActionColor(entry.action)}>
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.resource_type && (
                          <span className="text-sm">
                            <span className="text-muted-foreground">{entry.resource_type}:</span>{" "}
                            <span className="font-mono">{entry.resource_id?.slice(0, 8) || "-"}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {entry.details ? JSON.stringify(entry.details).slice(0, 50) : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {entry.ip_address || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="px-3 py-1 bg-secondary hover:bg-secondary/80 rounded text-sm disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1 bg-secondary hover:bg-secondary/80 rounded text-sm disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
