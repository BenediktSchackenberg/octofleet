"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { Search, Package, ArrowRight } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "openclaw-inventory-dev-key";

interface TopSoftware {
  name: string;
  count: number;
}

interface CompareResult {
  software: string;
  totalNodes: number;
  versions: Record<string, Array<{ nodeId: string; hostname: string }>>;
  results: Array<{
    nodeId: string;
    hostname: string;
    name: string;
    version: string;
    publisher: string;
  }>;
}

export default function SoftwareComparePage() {
  const [topSoftware, setTopSoftware] = useState<TopSoftware[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    fetchTopSoftware();
  }, []);

  async function fetchTopSoftware() {
    try {
      const res = await fetch(`${API_URL}/api/v1/software/compare`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        const json = await res.json();
        setTopSoftware(json.topSoftware || []);
      }
    } catch (e) {
      console.error("Failed to fetch top software:", e);
    } finally {
      setLoading(false);
    }
  }

  async function compareSoftware(name: string) {
    setComparing(true);
    setSearchQuery(name);
    try {
      const res = await fetch(`${API_URL}/api/v1/software/compare?software_name=${encodeURIComponent(name)}`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        setCompareResult(await res.json());
      }
    } catch (e) {
      console.error("Failed to compare software:", e);
    } finally {
      setComparing(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) {
      compareSoftware(searchQuery.trim());
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Breadcrumb items={[{ label: "Software Compare" }]} />
        <h1 className="text-2xl font-bold mb-6">📊 Software Compare</h1>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <Breadcrumb items={[{ label: "Software Compare" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📊 Software Compare</h1>
          <p className="text-muted-foreground">Compare software versions across nodes</p>
        </div>
        <a 
          href={`${API_URL}/api/v1/export/software?format=csv`}
          className="px-3 py-2 bg-secondary hover:bg-secondary/80 rounded text-sm"
        >
          📥 Export All Software
        </a>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search software (e.g. Chrome, Office, Python...)"
                className="w-full pl-10 pr-4 py-2 bg-secondary border border-input rounded-md"
              />
            </div>
            <button
              type="submit"
              disabled={comparing}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {comparing ? "Searching..." : "Compare"}
            </button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Software List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">🔥 Top Installed Software</CardTitle>
            <CardDescription>Click to compare versions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {topSoftware.slice(0, 30).map((sw, i) => (
                <div
                  key={i}
                  onClick={() => compareSoftware(sw.name)}
                  className="flex items-center justify-between p-2 rounded hover:bg-secondary cursor-pointer group"
                >
                  <span className="text-sm truncate flex-1" title={sw.name}>
                    {sw.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{sw.count}</Badge>
                    <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Compare Result */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              {compareResult ? `"${compareResult.software}"` : "Compare Result"}
            </CardTitle>
            {compareResult && (
              <CardDescription>
                Found on {compareResult.totalNodes} node(s) with {Object.keys(compareResult.versions).length} different version(s)
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {comparing ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : compareResult ? (
              <div className="space-y-4">
                {/* Version Summary */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {Object.entries(compareResult.versions).map(([version, nodes]) => (
                    <Badge 
                      key={version} 
                      variant={Object.keys(compareResult.versions).length > 1 ? "outline" : "default"}
                      className="text-sm"
                    >
                      v{version}: {nodes.length} node(s)
                    </Badge>
                  ))}
                </div>

                {/* Detailed Table */}
                <div className="max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hostname</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Publisher</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compareResult.results.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Link href={`/nodes/${r.nodeId}`} className="text-primary hover:underline">
                              {r.hostname}
                            </Link>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{r.version || "-"}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{r.publisher || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Version Mismatch Warning */}
                {Object.keys(compareResult.versions).length > 1 && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <p className="text-yellow-500 text-sm">
                      ⚠️ Multiple versions detected! Consider standardizing to the latest version.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Search for software or click on a title from the list</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
