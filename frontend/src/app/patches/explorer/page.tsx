'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, ChevronDown, Search, Filter, RefreshCw, Monitor, Terminal,
  Package, Shield, Rocket, Check, Minus, X, Loader2, ArrowRight,
  TreePine, Circle, Server, Bug, Clock, Wifi, WifiOff, History,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────

interface OsGroup {
  osName: string;
  osIcon: string;
  nodeCount: number;
  totalUpdates: number;
  criticalCount: number;
  status: string;
}

interface TreeSummary {
  totalNodes: number;
  totalUpdates: number;
  critical: number;
  outdated: number;
  update: number;
  current: number;
}

interface NodeItem {
  id: string;
  hostname: string;
  osName: string;
  isOnline: boolean;
  lastSeen: string;
  agentVersion: string;
  updateCount: number;
  criticalCount: number;
  status: string;
}

interface SoftwareItem {
  id: string;
  name: string;
  publisher: string;
  installedVersion: string;
  availableVersion: string;
  updateTitle: string;
  kbId: string;
  severity: string;
  source: string;
  isRebootRequired: boolean;
  status: string;
  cveCount: number;
}

interface SearchResult {
  type: string;
  id: string;
  hostname: string;
  osName: string;
  name: string;
  match: string;
  nodeId: string;
}

interface StatsData {
  totalNodes: number;
  totalUpdates: number;
  critical: number;
  important: number;
  moderate: number;
  low: number;
}

interface UpdateNode {
  nodeId: string;
  hostname: string;
  osName: string;
  isOnline: boolean;
  installedVersion: string;
  availableVersion: string;
}

interface UpdateGroup {
  key: string;
  title: string;
  kbId: string | null;
  severity: string;
  category: string;
  source: string;
  isRebootRequired: boolean;
  nodeCount: number;
  nodes: UpdateNode[];
}

interface UpdateTreeData {
  updates: UpdateGroup[];
  summary: {
    totalUpdates: number;
    totalAffectedNodes: number;
    critical: number;
    important: number;
    moderate: number;
    low: number;
  };
}

interface DeploymentResult {
  nodeId: string;
  hostname: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

interface DeploymentStatus {
  deploymentId: string;
  name: string;
  status: string;
  progress: { total: number; completed: number; failed: number; pending: number };
  results: DeploymentResult[];
}

interface DeploymentHistoryItem {
  id: string;
  name: string;
  rebootPolicy: string;
  createdBy: string;
  createdAt: string;
  status: string;
  nodeCount: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
}

type SelectedItem =
  | { type: 'none' }
  | { type: 'group'; osName: string; group: OsGroup }
  | { type: 'node'; node: NodeItem }
  | { type: 'software'; software: SoftwareItem; node: NodeItem }
  | { type: 'updateGroup'; updateGroup: UpdateGroup }
  | { type: 'updateNode'; updateGroup: UpdateGroup; updateNode: UpdateNode };

type FilterMode = 'all' | 'updates' | 'critical';
type TreeMode = 'node' | 'update' | 'history';

// ─── Status helpers ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  current: 'text-cyan-500',
  update: 'text-green-500',
  outdated: 'text-amber-500',
  critical: 'text-red-500',
};

const STATUS_BG: Record<string, string> = {
  current: 'bg-cyan-500/20 text-cyan-400',
  update: 'bg-green-500/20 text-green-400',
  outdated: 'bg-amber-500/20 text-amber-400',
  critical: 'bg-red-500/20 text-red-400',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  important: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  moderate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const PIE_COLORS = ['#06b6d4', '#22c55e', '#f59e0b', '#ef4444'];

const SEVERITY_DOT: Record<string, string> = {
  critical: 'text-red-500',
  important: 'text-amber-500',
  moderate: 'text-yellow-500',
  low: 'text-blue-500',
};

function StatusDot({ status }: { status: string }) {
  return <Circle className={`w-2.5 h-2.5 fill-current ${STATUS_COLORS[status] || 'text-zinc-500'}`} />;
}

function OsIcon({ osName }: { osName: string }) {
  const isWindows = (osName || '').toLowerCase().includes('win');
  return isWindows
    ? <Monitor className="w-4 h-4 text-blue-400" />
    : <Terminal className="w-4 h-4 text-green-400" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity?.toLowerCase() || 'low';
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${SEVERITY_COLORS[s] || SEVERITY_COLORS.low}`}>
      {severity}
    </span>
  );
}

// ─── Tri-state Checkbox ──────────────────────────────────────────────

function TriCheckbox({ state, disabled, onChange }: { state: 'none' | 'some' | 'all'; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(); }}
      disabled={disabled}
      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0
        ${disabled ? 'border-zinc-700 bg-zinc-800 cursor-not-allowed opacity-40' :
          state === 'all' ? 'border-emerald-500 bg-emerald-500' :
          state === 'some' ? 'border-emerald-500 bg-emerald-500/50' :
          'border-zinc-600 bg-zinc-800 hover:border-zinc-500'}`}
    >
      {state === 'all' && <Check className="w-3 h-3 text-white" />}
      {state === 'some' && <Minus className="w-3 h-3 text-white" />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════

export default function PatchExplorerPage() {
  // ─── State ─────────────────────────────────────────────────────────
  const [groups, setGroups] = useState<OsGroup[]>([]);
  const [summary, setSummary] = useState<TreeSummary | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodesCache, setNodesCache] = useState<Record<string, NodeItem[]>>({});
  const [softwareCache, setSoftwareCache] = useState<Record<string, SoftwareItem[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [loadingSoftware, setLoadingSoftware] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<SelectedItem>({ type: 'none' });
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [showFilter, setShowFilter] = useState(false);
  const [rebootPolicy, setRebootPolicy] = useState<string>('no_reboot');
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployingIds, setDeployingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [treeMode, setTreeMode] = useState<TreeMode>('node');
  const [updateTreeData, setUpdateTreeData] = useState<UpdateTreeData | null>(null);
  const [expandedUpdates, setExpandedUpdates] = useState<Set<string>>(new Set());
  const [checkedUpdateItems, setCheckedUpdateItems] = useState<Set<string>>(new Set()); // "nodeId:key" format
  const [loadingUpdateTree, setLoadingUpdateTree] = useState(false);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<DeploymentStatus | null>(null);
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedDeploymentDetail, setSelectedDeploymentDetail] = useState<DeploymentStatus | null>(null);
  const [nodeProgressMap, setNodeProgressMap] = useState<Record<string, string>>({}); // nodeId -> status for tree indicators
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ─── Data fetching ─────────────────────────────────────────────────

  const fetchTree = useCallback(async () => {
    setLoading(true);
    const data = await apiClient.get<{ groups: OsGroup[]; summary: TreeSummary }>('/patches/explorer/tree', { camelCase: true });
    if (data) {
      setGroups(data.groups);
      setSummary(data.summary);
    }
    setLoading(false);
  }, []);

  const fetchStats = useCallback(async () => {
    const data = await apiClient.get<StatsData>('/patches/explorer/stats');
    if (data) setStats(data);
  }, []);

  useEffect(() => { fetchTree(); fetchStats(); }, [fetchTree, fetchStats]);

  const fetchUpdateTree = useCallback(async () => {
    setLoadingUpdateTree(true);
    const data = await apiClient.get<UpdateTreeData>('/patches/explorer/by-update', { camelCase: true });
    if (data) setUpdateTreeData(data);
    setLoadingUpdateTree(false);
  }, []);

  useEffect(() => {
    if (treeMode === 'update' && !updateTreeData) fetchUpdateTree();
  }, [treeMode, updateTreeData, fetchUpdateTree]);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    const data = await apiClient.get<{ deployments: DeploymentHistoryItem[] }>('/patches/explorer/deployment-history', { camelCase: true });
    if (data) setDeploymentHistory(data.deployments);
    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    if (treeMode === 'history') fetchHistory();
  }, [treeMode, fetchHistory]);

  // SSE-based deployment status tracking (Phase 4)
  useEffect(() => {
    if (!activeDeploymentId) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '';
    const apiUrl = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8080` : '';
    const url = `${apiUrl}/api/v1/patches/explorer/deploy-stream/${activeDeploymentId}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const status: DeploymentStatus = JSON.parse(event.data);
        if ('error' in status) {
          es.close();
          return;
        }
        setDeployStatus(status);
        // Update node progress map for tree indicators
        const map: Record<string, string> = {};
        for (const r of status.results) {
          map[r.nodeId] = r.status;
        }
        setNodeProgressMap(map);
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('done', (event) => {
      try {
        const status: DeploymentStatus = JSON.parse((event as MessageEvent).data);
        setDeployStatus(status);
        // Auto-refresh after deployment completes
        const completedCount = status.progress.completed;
        const failedCount = status.progress.failed;
        toast.success(`Deployment complete: ${completedCount} installed, ${failedCount} failed`);
        // Clear software cache for affected nodes and re-fetch tree
        const affectedNodeIds = status.results.map(r => r.nodeId);
        setSoftwareCache(prev => {
          const next = { ...prev };
          for (const nid of affectedNodeIds) delete next[nid];
          return next;
        });
        fetchTree();
        fetchStats();
        if (treeMode === 'update') fetchUpdateTree();
        // Clear node progress map after brief delay
        setTimeout(() => setNodeProgressMap({}), 3000);
      } catch { /* ignore */ }
      es.close();
    });

    es.onerror = () => {
      // Fallback: on error, try regular polling once then close
      es.close();
    };

    return () => es.close();
  }, [activeDeploymentId, fetchTree, fetchStats, fetchUpdateTree, treeMode]);

  const fetchNodes = useCallback(async (osName: string) => {
    if (nodesCache[osName]) return;
    setLoadingNodes(prev => new Set(prev).add(osName));
    const data = await apiClient.get<{ nodes: NodeItem[] }>(`/patches/explorer/nodes?os=${encodeURIComponent(osName)}`, { camelCase: true });
    if (data) setNodesCache(prev => ({ ...prev, [osName]: data.nodes }));
    setLoadingNodes(prev => { const s = new Set(prev); s.delete(osName); return s; });
  }, [nodesCache]);

  const fetchSoftware = useCallback(async (nodeId: string) => {
    if (softwareCache[nodeId]) return;
    setLoadingSoftware(prev => new Set(prev).add(nodeId));
    const data = await apiClient.get<{ software: SoftwareItem[] }>(`/patches/explorer/node/${nodeId}/software`, { camelCase: true });
    if (data) setSoftwareCache(prev => ({ ...prev, [nodeId]: data.software }));
    setLoadingSoftware(prev => { const s = new Set(prev); s.delete(nodeId); return s; });
  }, [softwareCache]);

  // ─── Search ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setShowSearch(false); return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      const data = await apiClient.get<{ results: SearchResult[] }>(`/patches/explorer/search?q=${encodeURIComponent(searchQuery)}`, { camelCase: true });
      if (data) { setSearchResults(data.results); setShowSearch(true); }
    }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [searchQuery]);

  // close search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSearch(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Tree expand/collapse ─────────────────────────────────────────

  const toggleGroup = useCallback((osName: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(osName)) { next.delete(osName); } else { next.add(osName); fetchNodes(osName); }
      return next;
    });
  }, [fetchNodes]);

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) { next.delete(nodeId); } else { next.add(nodeId); fetchSoftware(nodeId); }
      return next;
    });
  }, [fetchSoftware]);

  // ─── Check logic ──────────────────────────────────────────────────

  const getUpdateableSoftwareIds = useCallback((nodeId: string): string[] => {
    return (softwareCache[nodeId] || []).filter(s => s.status !== 'current').map(s => s.id);
  }, [softwareCache]);

  const getNodeSoftwareIds = useCallback((nodeId: string): string[] => {
    return getUpdateableSoftwareIds(nodeId);
  }, [getUpdateableSoftwareIds]);

  const getGroupSoftwareIds = useCallback((osName: string): string[] => {
    return (nodesCache[osName] || []).flatMap(n => getNodeSoftwareIds(n.id));
  }, [nodesCache, getNodeSoftwareIds]);

  const getCheckState = useCallback((ids: string[]): 'none' | 'some' | 'all' => {
    if (ids.length === 0) return 'none';
    const checked = ids.filter(id => checkedItems.has(id));
    if (checked.length === 0) return 'none';
    if (checked.length === ids.length) return 'all';
    return 'some';
  }, [checkedItems]);

  const toggleChecked = useCallback((ids: string[]) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      const allChecked = ids.every(id => next.has(id));
      if (allChecked) { ids.forEach(id => next.delete(id)); }
      else { ids.forEach(id => next.add(id)); }
      return next;
    });
  }, []);

  const toggleSoftwareCheck = useCallback((id: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ─── "By Update" check logic ─────────────────────────────────────

  const getUpdateGroupCheckState = useCallback((ug: UpdateGroup): 'none' | 'some' | 'all' => {
    const keys = ug.nodes.map(n => `${n.nodeId}:${ug.key}`);
    if (keys.length === 0) return 'none';
    const checked = keys.filter(k => checkedUpdateItems.has(k));
    if (checked.length === 0) return 'none';
    if (checked.length === keys.length) return 'all';
    return 'some';
  }, [checkedUpdateItems]);

  const toggleUpdateGroupCheck = useCallback((ug: UpdateGroup) => {
    setCheckedUpdateItems(prev => {
      const next = new Set(prev);
      const keys = ug.nodes.map(n => `${n.nodeId}:${ug.key}`);
      const allChecked = keys.every(k => next.has(k));
      if (allChecked) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
  }, []);

  const toggleUpdateNodeCheck = useCallback((nodeId: string, updateKey: string) => {
    const k = `${nodeId}:${updateKey}`;
    setCheckedUpdateItems(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  const toggleUpdateExpanded = useCallback((key: string) => {
    setExpandedUpdates(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ─── Derived: checked summary ────────────────────────────────────

  const checkedSummary = useMemo(() => {
    if (treeMode === 'update') {
      const nodeIds = new Set<string>();
      let critical = 0, important = 0, moderate = 0, low = 0;
      if (updateTreeData) {
        for (const ug of updateTreeData.updates) {
          for (const n of ug.nodes) {
            if (checkedUpdateItems.has(`${n.nodeId}:${ug.key}`)) {
              nodeIds.add(n.nodeId);
              const sev = ug.severity?.toLowerCase();
              if (sev === 'critical') critical++;
              else if (sev === 'important') important++;
              else if (sev === 'moderate') moderate++;
              else low++;
            }
          }
        }
      }
      return { count: checkedUpdateItems.size, nodeCount: nodeIds.size, critical, important, moderate, low };
    }
    const nodeIds = new Set<string>();
    let critical = 0, important = 0, moderate = 0, low = 0;
    for (const [nodeId, swList] of Object.entries(softwareCache)) {
      for (const sw of swList) {
        if (checkedItems.has(sw.id)) {
          nodeIds.add(nodeId);
          const sev = sw.severity?.toLowerCase();
          if (sev === 'critical') critical++;
          else if (sev === 'important') important++;
          else if (sev === 'moderate') moderate++;
          else low++;
        }
      }
    }
    return { count: checkedItems.size, nodeCount: nodeIds.size, critical, important, moderate, low };
  }, [treeMode, checkedItems, checkedUpdateItems, softwareCache, updateTreeData]);

  // ─── Filter groups ────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    if (filter === 'all') return groups;
    if (filter === 'critical') return groups.filter(g => g.criticalCount > 0);
    if (filter === 'updates') return groups.filter(g => g.totalUpdates > 0);
    return groups;
  }, [groups, filter]);

  // ─── Deploy ───────────────────────────────────────────────────────

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    const items: { node_id: string; update_id: string; kb_id?: string; source?: string }[] = [];

    if (treeMode === 'update' && updateTreeData) {
      for (const ug of updateTreeData.updates) {
        for (const n of ug.nodes) {
          if (checkedUpdateItems.has(`${n.nodeId}:${ug.key}`)) {
            items.push({ node_id: n.nodeId, update_id: ug.key, kb_id: ug.kbId || undefined, source: ug.source || 'windows_update' });
          }
        }
      }
    } else {
      for (const [nodeId, swList] of Object.entries(softwareCache)) {
        for (const sw of swList) {
          if (checkedItems.has(sw.id)) items.push({ node_id: nodeId, update_id: sw.id, kb_id: sw.kbId || undefined, source: sw.source || 'windows_update' });
        }
      }
    }

    const data = await apiClient.post<{ deploymentId: string; jobId: string; message: string }>(
      '/patches/explorer/deploy',
      { name: deployName || 'Patch Explorer Deployment', reboot_policy: rebootPolicy, updates: items }
    );
    setDeploying(false);
    if (data) {
      toast.success(data.message || 'Deployment started');
      setShowDeploy(false);
      setActiveDeploymentId(data.deploymentId);
      if (treeMode === 'update') {
        setCheckedUpdateItems(new Set());
      } else {
        setDeployingIds(new Set(checkedItems));
        setCheckedItems(new Set());
      }
      // Poll for software refresh
      const nodeIdsToRefresh = new Set(items.map(i => i.node_id));
      const poll = setInterval(async () => {
        for (const nid of nodeIdsToRefresh) {
          const d = await apiClient.get<{ software: SoftwareItem[] }>(`/patches/explorer/node/${nid}/software`, { camelCase: true });
          if (d) setSoftwareCache(prev => ({ ...prev, [nid]: d.software }));
        }
      }, 5000);
      setTimeout(() => { clearInterval(poll); setDeployingIds(new Set()); }, 60000);
    }
  }, [treeMode, checkedItems, checkedUpdateItems, updateTreeData, softwareCache, deployName, rebootPolicy]);

  // ─── Search result click ──────────────────────────────────────────

  const handleSearchClick = useCallback(async (result: SearchResult) => {
    setShowSearch(false);
    setSearchQuery('');
    if (result.type === 'node' || result.type === 'software') {
      // expand the OS group
      const osName = result.osName;
      if (osName) {
        setExpandedGroups(prev => new Set(prev).add(osName));
        await fetchNodes(osName);
      }
      if (result.type === 'software' && result.nodeId) {
        setExpandedNodes(prev => new Set(prev).add(result.nodeId));
        await fetchSoftware(result.nodeId);
      }
    }
  }, [fetchNodes, fetchSoftware]);

  // ─── Render ────────────────────────────────────────────────────────

  const renderDeployByNode = useMemo(() => {
    const byNode: Record<string, { node: NodeItem; software: SoftwareItem[] }> = {};
    for (const [nodeId, swList] of Object.entries(softwareCache)) {
      const checked = swList.filter(sw => checkedItems.has(sw.id));
      if (checked.length > 0) {
        const node = Object.values(nodesCache).flat().find(n => n.id === nodeId);
        if (node) byNode[nodeId] = { node, software: checked };
      }
    }
    return byNode;
  }, [checkedItems, softwareCache, nodesCache]);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <TreePine className="w-5 h-5 text-emerald-500" />
            <h1 className="text-lg font-semibold text-zinc-100">Patch Explorer</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div ref={searchRef} className="relative">
              <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 gap-2 w-64 focus-within:border-zinc-500 transition-colors">
                <Search className="w-4 h-4 text-zinc-500" />
                <input
                  className="bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none flex-1"
                  placeholder="Search nodes, software..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => { if (searchResults.length > 0) setShowSearch(true); }}
                />
              </div>
              <AnimatePresence>
                {showSearch && searchResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 max-h-64 overflow-auto"
                  >
                    {searchResults.map((r, i) => (
                      <button key={i} onClick={() => handleSearchClick(r)}
                        className="flex items-center gap-3 px-3 py-2 w-full hover:bg-zinc-800 text-left transition-colors"
                      >
                        {r.type === 'node' ? <Monitor className="w-4 h-4 text-blue-400" /> :
                         r.type === 'software' ? <Package className="w-4 h-4 text-purple-400" /> :
                         <Shield className="w-4 h-4 text-amber-400" />}
                        <span className="text-sm text-zinc-200 flex-1 truncate">{r.match}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          r.type === 'node' ? 'bg-blue-500/20 text-blue-400' :
                          r.type === 'software' ? 'bg-purple-500/20 text-purple-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>{r.type}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Filter */}
            <div className="relative">
              <button onClick={() => setShowFilter(!showFilter)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                <Filter className="w-4 h-4" /> Filter
                {filter !== 'all' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
              </button>
              <AnimatePresence>
                {showFilter && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 w-48"
                  >
                    {([['all', 'Show All'], ['updates', 'With Updates'], ['critical', 'Critical Only']] as const).map(([val, label]) => (
                      <button key={val} onClick={() => { setFilter(val); setShowFilter(false); }}
                        className={`flex items-center gap-2 px-3 py-2 w-full text-sm text-left transition-colors hover:bg-zinc-800
                          ${filter === val ? 'text-emerald-400' : 'text-zinc-300'}`}
                      >
                        {filter === val && <Check className="w-3 h-3" />}
                        <span className={filter !== val ? 'ml-5' : ''}>{label}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={() => { fetchTree(); fetchStats(); }} className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={async () => {
                // Trigger patch scan on all online nodes
                const treeData = await apiClient.get<{ groups: { osName: string }[] }>('/patches/explorer/tree', { camelCase: true });
                if (!treeData) return;
                const allNodeIds: string[] = [];
                for (const g of treeData.groups) {
                  const nd = await apiClient.get<{ nodes: { id: string; isOnline: boolean }[] }>(`/patches/explorer/nodes?os=${encodeURIComponent(g.osName)}`, { camelCase: true });
                  if (nd) allNodeIds.push(...nd.nodes.filter(n => n.isOnline).map(n => n.id));
                }
                if (allNodeIds.length === 0) return;
                const res = await apiClient.post('/patches/explorer/scan', { node_ids: allNodeIds });
                if (res) toast.success(`Patch scan triggered on ${allNodeIds.length} nodes`);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors"
            >
              <Search className="w-3.5 h-3.5" /> Scan Now
            </button>
          </div>
        </div>

        {/* Summary bar */}
        {summary && (
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {summary.totalNodes} Nodes</span>
            <span className="w-px h-3 bg-zinc-700" />
            <span className="flex items-center gap-1"><Package className="w-3 h-3" /> {summary.totalUpdates} Updates</span>
            <span className="w-px h-3 bg-zinc-700" />
            <span className="flex items-center gap-1 text-red-400"><Circle className="w-2 h-2 fill-red-500" /> {summary.critical} Critical</span>
            <span className="w-px h-3 bg-zinc-700" />
            <span className="flex items-center gap-1 text-amber-400"><Circle className="w-2 h-2 fill-amber-500" /> {summary.outdated} Outdated</span>
            {filter !== 'all' && (
              <>
                <span className="w-px h-3 bg-zinc-700" />
                <button onClick={() => setFilter('all')} className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
                  <X className="w-3 h-3" /> Clear filter
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Main split ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── Tree Panel ──────────────────────────────────────── */}
        <div className="w-[400px] border-r border-zinc-800 overflow-y-auto bg-zinc-950">
          {/* Tab switcher */}
          <div className="flex border-b border-zinc-700 sticky top-0 bg-zinc-950 z-10">
            <button onClick={() => setTreeMode('node')} className={`px-4 py-2 text-sm font-medium transition-colors ${treeMode === 'node' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-zinc-400 hover:text-zinc-200'}`}>
              By Node
            </button>
            <button onClick={() => setTreeMode('update')} className={`px-4 py-2 text-sm font-medium transition-colors ${treeMode === 'update' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-zinc-400 hover:text-zinc-200'}`}>
              By Update
            </button>
            <button onClick={() => setTreeMode('history')} className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${treeMode === 'history' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-zinc-400 hover:text-zinc-200'}`}>
              <History className="w-3.5 h-3.5" /> History
            </button>
          </div>

          {treeMode === 'node' ? (
          /* ─── By Node Tree ─── */
          loading && groups.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <div className="py-2">
              {filteredGroups.map(group => {
                const isExpanded = expandedGroups.has(group.osName);
                const nodes = nodesCache[group.osName] || [];
                const groupIds = getGroupSoftwareIds(group.osName);
                const groupCheck = getCheckState(groupIds);

                return (
                  <div key={group.osName}>
                    {/* OS Group Row */}
                    <button
                      onClick={() => { toggleGroup(group.osName); setSelectedItem({ type: 'group', osName: group.osName, group }); }}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-zinc-900 transition-colors group
                        ${selectedItem.type === 'group' && selectedItem.osName === group.osName ? 'bg-zinc-900' : ''}`}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                      <TriCheckbox state={groupCheck} onChange={() => toggleChecked(groupIds)} disabled={groupIds.length === 0} />
                      <OsIcon osName={group.osName} />
                      <span className="text-sm text-zinc-200 flex-1 truncate">{group.osName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium">{group.nodeCount}</span>
                      <StatusDot status={group.status} />
                    </button>

                    {/* Nodes */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          {loadingNodes.has(group.osName) ? (
                            <div className="pl-10 py-2"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
                          ) : nodes.map(node => {
                            const isNodeExpanded = expandedNodes.has(node.id);
                            const software = softwareCache[node.id] || [];
                            const nodeIds = getNodeSoftwareIds(node.id);
                            const nodeCheck = getCheckState(nodeIds);

                            return (
                              <div key={node.id}>
                                <button
                                  onClick={() => { toggleNode(node.id); setSelectedItem({ type: 'node', node }); }}
                                  className={`flex items-center gap-2 w-full pl-8 pr-3 py-1.5 text-left hover:bg-zinc-900/80 transition-colors
                                    ${selectedItem.type === 'node' && selectedItem.node.id === node.id ? 'bg-zinc-900/80' : ''}`}
                                >
                                  {isNodeExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                                  <TriCheckbox state={nodeCheck} onChange={() => toggleChecked(nodeIds)} disabled={nodeIds.length === 0} />
                                  {nodeProgressMap[node.id] === 'running' || nodeProgressMap[node.id] === 'installing'
                                    ? <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-400" />
                                    : nodeProgressMap[node.id] === 'completed' || nodeProgressMap[node.id] === 'installed'
                                    ? <Check className="w-2.5 h-2.5 text-green-400" />
                                    : nodeProgressMap[node.id] === 'failed'
                                    ? <X className="w-2.5 h-2.5 text-red-400" />
                                    : <StatusDot status={node.status} />}
                                  <span className="text-sm text-zinc-300 flex-1 truncate font-mono">{node.hostname}</span>
                                  {node.updateCount > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{node.updateCount} updates</span>
                                  )}
                                  {node.isOnline
                                    ? <Wifi className="w-3 h-3 text-green-500" />
                                    : <WifiOff className="w-3 h-3 text-red-500" />}
                                </button>

                                {/* Software */}
                                <AnimatePresence>
                                  {isNodeExpanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="overflow-hidden"
                                    >
                                      {loadingSoftware.has(node.id) ? (
                                        <div className="pl-16 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /></div>
                                      ) : software.map(sw => {
                                        const isCurrent = sw.status === 'current';
                                        const isDeploying = deployingIds.has(sw.id);
                                        return (
                                          <button
                                            key={sw.id}
                                            onClick={() => setSelectedItem({ type: 'software', software: sw, node })}
                                            className={`flex items-center gap-2 w-full pl-14 pr-3 py-1 text-left hover:bg-zinc-900/60 transition-colors
                                              ${selectedItem.type === 'software' && selectedItem.software.id === sw.id ? 'bg-zinc-900/60' : ''}`}
                                          >
                                            <TriCheckbox
                                              state={checkedItems.has(sw.id) ? 'all' : 'none'}
                                              disabled={isCurrent}
                                              onChange={() => toggleSoftwareCheck(sw.id)}
                                            />
                                            {isDeploying
                                              ? <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-400" />
                                              : <StatusDot status={sw.status} />}
                                            <span className={`text-xs flex-1 truncate ${isCurrent ? 'text-zinc-500' : 'text-zinc-300'}`}>{sw.name}</span>
                                            <span className="text-[10px] text-zinc-500 hidden xl:inline">{sw.installedVersion} → {sw.availableVersion}</span>
                                            {sw.kbId && <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500">{sw.kbId}</span>}
                                            <SeverityBadge severity={sw.severity} />
                                          </button>
                                        );
                                      })}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {/* Tree summary */}
              {summary && (
                <div className="mt-4 mx-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Summary</div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-zinc-400">
                    <span>{summary.totalNodes} Nodes</span>
                    <span>{summary.totalUpdates} Updates</span>
                    <span className="text-red-400">{summary.critical} Critical</span>
                    <span className="text-amber-400">{summary.outdated} Outdated</span>
                  </div>
                </div>
              )}
            </div>
          )
          ) : (
          /* ─── By Update Tree ─── */
          loadingUpdateTree ? (
            <div className="flex items-center justify-center h-40 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : updateTreeData ? (
            <div className="py-2">
              {updateTreeData.updates.map(ug => {
                const isExpanded = expandedUpdates.has(ug.key);
                const groupCheck = getUpdateGroupCheckState(ug);
                const sevDot = SEVERITY_DOT[ug.severity?.toLowerCase()] || SEVERITY_DOT.low;

                return (
                  <div key={ug.key}>
                    <button
                      onClick={() => { toggleUpdateExpanded(ug.key); setSelectedItem({ type: 'updateGroup', updateGroup: ug }); }}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-zinc-900 transition-colors
                        ${selectedItem.type === 'updateGroup' && selectedItem.updateGroup.key === ug.key ? 'bg-zinc-900' : ''}`}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                      <TriCheckbox state={groupCheck} onChange={() => toggleUpdateGroupCheck(ug)} />
                      <Circle className={`w-2.5 h-2.5 fill-current ${sevDot}`} />
                      <span className="text-sm text-zinc-200 flex-1 truncate">{ug.title}</span>
                      {ug.kbId && <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 shrink-0">{ug.kbId}</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium shrink-0">{ug.nodeCount}</span>
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          {ug.nodes.map(un => {
                            const nodeKey = `${un.nodeId}:${ug.key}`;
                            return (
                              <button
                                key={nodeKey}
                                onClick={() => setSelectedItem({ type: 'updateNode', updateGroup: ug, updateNode: un })}
                                className={`flex items-center gap-2 w-full pl-10 pr-3 py-1.5 text-left hover:bg-zinc-900/80 transition-colors
                                  ${selectedItem.type === 'updateNode' && selectedItem.updateNode.nodeId === un.nodeId && selectedItem.updateGroup.key === ug.key ? 'bg-zinc-900/80' : ''}`}
                              >
                                <TriCheckbox
                                  state={checkedUpdateItems.has(nodeKey) ? 'all' : 'none'}
                                  onChange={() => toggleUpdateNodeCheck(un.nodeId, ug.key)}
                                />
                                <span className="text-sm text-zinc-300 font-mono truncate">{un.hostname}</span>
                                <span className="text-[10px] text-zinc-500 truncate">{un.installedVersion} → {un.availableVersion}</span>
                                {un.isOnline
                                  ? <Wifi className="w-3 h-3 text-green-500 shrink-0 ml-auto" />
                                  : <WifiOff className="w-3 h-3 text-red-500 shrink-0 ml-auto" />}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {updateTreeData.summary && (
                <div className="mt-4 mx-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Summary</div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-zinc-400">
                    <span>{updateTreeData.summary.totalUpdates} Updates</span>
                    <span>{updateTreeData.summary.totalAffectedNodes} Nodes</span>
                    <span className="text-red-400">{updateTreeData.summary.critical} Critical</span>
                    <span className="text-amber-400">{updateTreeData.summary.important} Important</span>
                  </div>
                </div>
              )}
            </div>
          ) : null
          )}

          {/* ─── History Tab ─── */}
          {treeMode === 'history' && (
            loadingHistory ? (
              <div className="flex items-center justify-center h-40 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : (
              <div className="py-2">
                {deploymentHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-zinc-500 text-sm">
                    <History className="w-8 h-8 mb-2 opacity-30" />
                    No deployments yet
                  </div>
                ) : deploymentHistory.map(dep => (
                  <button
                    key={dep.id}
                    onClick={async () => {
                      const detail = await apiClient.get<DeploymentStatus>(`/patches/explorer/deployment-status/${dep.id}`, { camelCase: true });
                      if (detail) setSelectedDeploymentDetail(detail);
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-zinc-900 transition-colors border-b border-zinc-800/50
                      ${selectedDeploymentDetail?.deploymentId === dep.id ? 'bg-zinc-900' : ''}`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      dep.status === 'completed' ? 'bg-green-500' :
                      dep.status === 'failed' ? 'bg-red-500' :
                      dep.status === 'running' ? 'bg-blue-500 animate-pulse' :
                      dep.status === 'partial' ? 'bg-amber-500' :
                      'bg-zinc-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-200 truncate">{dep.name}</div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                        <span>{new Date(dep.createdAt).toLocaleDateString()}</span>
                        <span>{dep.nodeCount} nodes</span>
                        {dep.failedCount > 0 && <span className="text-red-400">{dep.failedCount} failed</span>}
                      </div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      dep.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      dep.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      dep.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                      dep.status === 'partial' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-zinc-700 text-zinc-400'
                    }`}>{dep.status}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {/* ─── Detail Panel ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-zinc-950">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedItem.type === 'none' ? 'none' : selectedItem.type === 'group' ? selectedItem.osName : selectedItem.type === 'node' ? selectedItem.node.id : selectedItem.type === 'software' ? selectedItem.software.id : selectedItem.type === 'updateGroup' ? selectedItem.updateGroup.key : selectedItem.type === 'updateNode' ? `${selectedItem.updateNode.nodeId}-${selectedItem.updateGroup.key}` : ''}
              initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="p-6"
            >
              {/* Deployment Status Banner */}
              {activeDeploymentId && deployStatus && (
                <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Rocket className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-medium text-zinc-200">{deployStatus.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        deployStatus.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        deployStatus.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        deployStatus.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-zinc-700 text-zinc-400'
                      }`}>{deployStatus.status}</span>
                    </div>
                    {deployStatus.progress.pending === 0 && (
                      <button onClick={() => { setActiveDeploymentId(null); setDeployStatus(null); }} className="text-zinc-500 hover:text-zinc-300">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-zinc-800 rounded-full h-2 mb-3">
                    <div
                      className="h-2 rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${deployStatus.progress.total > 0 ? ((deployStatus.progress.completed + deployStatus.progress.failed) / deployStatus.progress.total * 100) : 0}%` }}
                    />
                  </div>
                  <div className="text-xs text-zinc-500 mb-2">
                    {deployStatus.progress.completed}/{deployStatus.progress.total} completed
                    {deployStatus.progress.failed > 0 && <span className="text-red-400 ml-2">{deployStatus.progress.failed} failed</span>}
                  </div>
                  <div className="space-y-1">
                    {deployStatus.results.map(r => (
                      <div key={r.nodeId} className="flex items-center gap-2 text-xs">
                        {r.status === 'pending' ? <Circle className="w-3 h-3 text-zinc-500" /> :
                         r.status === 'running' || r.status === 'installing' ? <Loader2 className="w-3 h-3 animate-spin text-blue-400" /> :
                         r.status === 'installed' || r.status === 'completed' ? <Check className="w-3 h-3 text-green-400" /> :
                         r.status === 'failed' ? <X className="w-3 h-3 text-red-400" /> :
                         <Circle className="w-3 h-3 text-zinc-500" />}
                        <span className="font-mono text-zinc-300">{r.hostname}</span>
                        <span className={`ml-auto ${
                          r.status === 'installed' || r.status === 'completed' ? 'text-green-400' :
                          r.status === 'failed' ? 'text-red-400' :
                          r.status === 'running' || r.status === 'installing' ? 'text-blue-400' :
                          'text-zinc-500'
                        }`}>{r.status}</span>
                        {r.errorMessage && <span className="text-red-400 truncate max-w-[200px]" title={r.errorMessage}>{r.errorMessage}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedItem.type === 'none' && !selectedDeploymentDetail && <WelcomePanel stats={stats} />}
              {selectedDeploymentDetail && (
                <DeploymentDetailPanel
                  detail={selectedDeploymentDetail}
                  onClose={() => setSelectedDeploymentDetail(null)}
                  onVerify={async () => {
                    const res = await apiClient.post<{ message: string }>(`/patches/explorer/verify/${selectedDeploymentDetail.deploymentId}`, {});
                    if (res) toast.success(res.message || 'Verification scan triggered');
                  }}
                />
              )}
              {selectedItem.type === 'group' && <GroupDetail group={selectedItem.group} nodes={nodesCache[selectedItem.osName] || []} onSelectNode={(n) => setSelectedItem({ type: 'node', node: n })} />}
              {selectedItem.type === 'node' && <NodeDetail node={selectedItem.node} software={softwareCache[selectedItem.node.id] || []} deployingIds={deployingIds} onSelectSoftware={(sw) => setSelectedItem({ type: 'software', software: sw, node: selectedItem.node })} />}
              {selectedItem.type === 'software' && <SoftwareDetail software={selectedItem.software} node={selectedItem.node} onDeploy={(sw) => { setCheckedItems(new Set([sw.id])); setShowDeploy(true); }} />}
              {selectedItem.type === 'updateGroup' && <UpdateGroupDetail updateGroup={selectedItem.updateGroup} onSelectNode={(un) => setSelectedItem({ type: 'updateNode', updateGroup: selectedItem.updateGroup, updateNode: un })} onDeployAll={() => { toggleUpdateGroupCheck(selectedItem.updateGroup); setDeployName(`Deploy ${selectedItem.updateGroup.title}`); setShowDeploy(true); }} />}
              {selectedItem.type === 'updateNode' && <UpdateNodeDetail updateGroup={selectedItem.updateGroup} updateNode={selectedItem.updateNode} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ─── Floating Action Bar ─────────────────────────────────── */}
      <AnimatePresence>
        {(treeMode === 'node' ? checkedItems.size > 0 : checkedUpdateItems.size > 0) && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-zinc-800 bg-zinc-900 px-6 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-200">
                <Check className="w-4 h-4 inline text-emerald-500 mr-1" />
                {checkedSummary.count} Updates selected ({checkedSummary.nodeCount} Nodes)
              </span>
              <div className="flex items-center gap-1.5 text-[10px]">
                {checkedSummary.critical > 0 && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{checkedSummary.critical} Critical</span>}
                {checkedSummary.important > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{checkedSummary.important} Important</span>}
                {checkedSummary.moderate > 0 && <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">{checkedSummary.moderate} Moderate</span>}
                {checkedSummary.low > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{checkedSummary.low} Low</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={rebootPolicy}
                onChange={e => setRebootPolicy(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-300 outline-none"
              >
                <option value="no_reboot">No Reboot</option>
                <option value="after_each">After Each</option>
                <option value="after_all">After All</option>
                <option value="scheduled">Scheduled</option>
              </select>
              <button
                onClick={() => { setDeployName(`Patch Explorer ${new Date().toLocaleDateString()}`); setShowDeploy(true); }}
                className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Rocket className="w-4 h-4" /> Deploy
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Deploy Dialog ────────────────────────────────────────── */}
      <AnimatePresence>
        {showDeploy && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setShowDeploy(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg p-6"
            >
              <h2 className="text-lg font-semibold text-zinc-100 mb-4 flex items-center gap-2">
                <Rocket className="w-5 h-5 text-emerald-500" /> Confirm Deployment
              </h2>

              <div className="mb-4">
                <label className="text-xs text-zinc-400 mb-1 block">Deployment Name</label>
                <input
                  value={deployName}
                  onChange={e => setDeployName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                />
              </div>

              <div className="mb-4 text-xs text-zinc-400">
                <span>Reboot Policy: <strong className="text-zinc-300">{rebootPolicy.replace(/_/g, ' ')}</strong></span>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-3 mb-4">
                {Object.entries(renderDeployByNode).map(([nodeId, { node, software }]) => (
                  <div key={nodeId} className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Monitor className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-sm text-zinc-200 font-mono">{node.hostname}</span>
                      <span className="text-[10px] text-zinc-500">{software.length} updates</span>
                    </div>
                    {software.map(sw => (
                      <div key={sw.id} className="flex items-center gap-2 pl-5 py-0.5">
                        <span className="text-xs text-zinc-400 truncate flex-1">{sw.name}</span>
                        <SeverityBadge severity={sw.severity} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => setShowDeploy(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
                <button onClick={handleDeploy} disabled={deploying}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                  Deploy
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETAIL PANELS
// ═══════════════════════════════════════════════════════════════════════

function WelcomePanel({ stats }: { stats: StatsData | null }) {
  const chartData = stats ? [
    { name: 'Critical', value: stats.critical, color: '#ef4444' },
    { name: 'Important', value: stats.important, color: '#f59e0b' },
    { name: 'Moderate', value: stats.moderate, color: '#eab308' },
    { name: 'Low', value: stats.low, color: '#3b82f6' },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
      <TreePine className="w-12 h-12 text-emerald-500/30 mb-4" />
      <h2 className="text-xl font-semibold text-zinc-200 mb-2">Patch Explorer</h2>
      <p className="text-sm text-zinc-500 mb-8 max-w-sm">Browse your fleet by OS, select nodes and updates, then deploy patches — all from one place.</p>

      {stats && (
        <div className="flex items-center gap-8">
          <div className="w-40 h-40">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="text-left space-y-2">
            <div className="text-2xl font-bold text-zinc-100">{stats.totalUpdates}</div>
            <div className="text-xs text-zinc-500">Total Updates</div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2"><Circle className="w-2 h-2 fill-red-500 text-red-500" /> {stats.critical} Critical</div>
              <div className="flex items-center gap-2"><Circle className="w-2 h-2 fill-amber-500 text-amber-500" /> {stats.important} Important</div>
              <div className="flex items-center gap-2"><Circle className="w-2 h-2 fill-yellow-500 text-yellow-500" /> {stats.moderate} Moderate</div>
              <div className="flex items-center gap-2"><Circle className="w-2 h-2 fill-blue-500 text-blue-500" /> {stats.low} Low</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupDetail({ group, nodes, onSelectNode }: { group: OsGroup; nodes: NodeItem[]; onSelectNode: (n: NodeItem) => void }) {
  const statusData = [
    { name: 'Current', value: nodes.filter(n => n.status === 'current').length, color: '#06b6d4' },
    { name: 'Update', value: nodes.filter(n => n.status === 'update').length, color: '#22c55e' },
    { name: 'Outdated', value: nodes.filter(n => n.status === 'outdated').length, color: '#f59e0b' },
    { name: 'Critical', value: nodes.filter(n => n.status === 'critical').length, color: '#ef4444' },
  ].filter(d => d.value > 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <OsIcon osName={group.osName} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{group.osName}</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{group.nodeCount} nodes</span>
            <span>{group.totalUpdates} updates</span>
            {group.criticalCount > 0 && <span className="text-red-400">{group.criticalCount} critical</span>}
          </div>
        </div>
      </div>

      {nodes.length > 0 && statusData.length > 0 && (
        <div className="mb-6 w-32 h-32">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={25} outerRadius={45} dataKey="value" paddingAngle={3}>
                {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {nodes.map(node => (
          <button key={node.id} onClick={() => onSelectNode(node)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-left hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <StatusDot status={node.status} />
              <span className="text-sm font-mono text-zinc-200 truncate">{node.hostname}</span>
              {node.isOnline ? <Wifi className="w-3 h-3 text-green-500 ml-auto" /> : <WifiOff className="w-3 h-3 text-red-500 ml-auto" />}
            </div>
            <div className="text-xs text-zinc-500">
              {node.updateCount} updates {node.criticalCount > 0 && <span className="text-red-400">({node.criticalCount} critical)</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NodeDetail({ node, software, deployingIds, onSelectSoftware }: { node: NodeItem; software: SoftwareItem[]; deployingIds: Set<string>; onSelectSoftware: (sw: SoftwareItem) => void }) {
  const [sortCol, setSortCol] = useState<string>('severity');
  const [sortAsc, setSortAsc] = useState(false);

  const sevOrder: Record<string, number> = { critical: 0, important: 1, moderate: 2, low: 3 };

  const sorted = useMemo(() => {
    return [...software].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'severity') cmp = (sevOrder[a.severity?.toLowerCase()] ?? 4) - (sevOrder[b.severity?.toLowerCase()] ?? 4);
      else if (sortCol === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortCol === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortCol === 'source') cmp = (a.source || '').localeCompare(b.source || '');
      return sortAsc ? cmp : -cmp;
    });
  }, [software, sortCol, sortAsc]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <OsIcon osName={node.osName} />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-zinc-100 font-mono">{node.hostname}</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{node.osName}</span>
            <span className={`flex items-center gap-1 ${node.isOnline ? 'text-green-400' : 'text-red-400'}`}>
              {node.isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {node.isOnline ? 'Online' : 'Offline'}
            </span>
            <span>Agent {node.agentVersion}</span>
            <span><Clock className="w-3 h-3 inline" /> {new Date(node.lastSeen).toLocaleString()}</span>
          </div>
        </div>
        <span className={`px-2 py-1 rounded-lg text-xs font-medium ${STATUS_BG[node.status] || ''}`}>{node.status}</span>
      </div>

      <div className="mt-6 mb-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">Software ({software.length})</div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-900/80 text-zinc-500">
              {[['status', 'Status'], ['name', 'Name'], ['installed', 'Installed'], ['available', 'Available'], ['severity', 'Severity'], ['source', 'Source']].map(([col, label]) => (
                <th key={col} onClick={() => handleSort(col)} className="px-3 py-2 text-left cursor-pointer hover:text-zinc-300 transition-colors select-none">
                  {label} {sortCol === col && (sortAsc ? '↑' : '↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(sw => (
              <tr key={sw.id} onClick={() => onSelectSoftware(sw)}
                className="border-t border-zinc-800/50 hover:bg-zinc-900/60 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2">
                  {deployingIds.has(sw.id)
                    ? <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                    : <StatusDot status={sw.status} />}
                </td>
                <td className="px-3 py-2 text-zinc-200 max-w-[200px] truncate">{sw.name}</td>
                <td className="px-3 py-2 text-zinc-500 font-mono">{sw.installedVersion}</td>
                <td className="px-3 py-2 text-zinc-300 font-mono">{sw.availableVersion}</td>
                <td className="px-3 py-2"><SeverityBadge severity={sw.severity} /></td>
                <td className="px-3 py-2 text-zinc-500">{sw.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-xs text-zinc-600">
        <div className="uppercase tracking-wider font-medium mb-2">Update History</div>
        <p className="text-zinc-500 italic">Update history will be available in a future release.</p>
      </div>
    </div>
  );
}

function SoftwareDetail({ software: sw, node, onDeploy }: { software: SoftwareItem; node: NodeItem; onDeploy: (sw: SoftwareItem) => void }) {
  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Package className="w-6 h-6 text-purple-400" />
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{sw.name}</h2>
            <p className="text-xs text-zinc-500">{sw.publisher}</p>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <div className="text-xs text-zinc-500 mb-2">Version</div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-zinc-400 bg-zinc-800 px-2 py-1 rounded">{sw.installedVersion}</span>
          <ArrowRight className="w-4 h-4 text-emerald-500" />
          <span className="font-mono text-sm text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">{sw.availableVersion}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {sw.kbId && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <div className="text-[10px] text-zinc-500 mb-1">KB Article</div>
            <div className="text-sm text-zinc-200 font-mono">{sw.kbId}</div>
          </div>
        )}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 mb-1">Severity</div>
          <SeverityBadge severity={sw.severity} />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 mb-1">CVEs</div>
          <div className="flex items-center gap-1">
            <Bug className="w-3 h-3 text-red-400" />
            <span className="text-sm text-zinc-200">{sw.cveCount}</span>
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 mb-1">Source</div>
          <div className="text-sm text-zinc-200">{sw.source}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 mb-1">Reboot Required</div>
          <div className="text-sm text-zinc-200">{sw.isRebootRequired ? 'Yes' : 'No'}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 mb-1">Node</div>
          <div className="text-sm text-zinc-200 font-mono">{node.hostname}</div>
        </div>
      </div>

      {sw.status !== 'current' && (
        <button onClick={() => onDeploy(sw)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Rocket className="w-4 h-4" /> Deploy this update
        </button>
      )}

      <div className="mt-6 text-xs text-zinc-600">
        <div className="uppercase tracking-wider font-medium mb-2">Other nodes with this software</div>
        <p className="text-zinc-500 italic">Cross-node analysis will be available in a future release.</p>
      </div>
    </div>
  );
}

function UpdateGroupDetail({ updateGroup: ug, onSelectNode, onDeployAll }: { updateGroup: UpdateGroup; onSelectNode: (un: UpdateNode) => void; onDeployAll: () => void }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">{ug.title}</h2>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <SeverityBadge severity={ug.severity} />
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-zinc-600 text-zinc-400">{ug.category}</span>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-zinc-600 text-zinc-400">{ug.source}</span>
          {ug.kbId && <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300">{ug.kbId}</span>}
          {ug.isRebootRequired && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">Reboot Required</span>
          )}
        </div>
      </div>

      <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Affected Nodes ({ug.nodeCount})</div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {ug.nodes.map(un => (
          <button key={un.nodeId} onClick={() => onSelectNode(un)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-left hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-mono text-zinc-200 truncate">{un.hostname}</span>
              {un.isOnline ? <Wifi className="w-3 h-3 text-green-500 ml-auto" /> : <WifiOff className="w-3 h-3 text-red-500 ml-auto" />}
            </div>
            <div className="text-xs text-zinc-500 truncate">{un.osName}</div>
            <div className="text-xs text-zinc-400 font-mono mt-1">
              {un.installedVersion} <ArrowRight className="w-3 h-3 inline text-emerald-500" /> {un.availableVersion}
            </div>
          </button>
        ))}
      </div>

      <button onClick={onDeployAll}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
      >
        <Rocket className="w-4 h-4" /> Deploy to all {ug.nodeCount} nodes
      </button>
    </div>
  );
}

function UpdateNodeDetail({ updateGroup: ug, updateNode: un }: { updateGroup: UpdateGroup; updateNode: UpdateNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <OsIcon osName={un.osName} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 font-mono">{un.hostname}</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{un.osName}</span>
            <span className={`flex items-center gap-1 ${un.isOnline ? 'text-green-400' : 'text-red-400'}`}>
              {un.isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {un.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <div className="text-xs text-zinc-500 mb-1">Update</div>
        <div className="text-sm text-zinc-200 mb-2">{ug.title}</div>
        <div className="flex items-center gap-2 mb-2">
          <SeverityBadge severity={ug.severity} />
          {ug.kbId && <span className="text-[10px] font-mono text-zinc-400">{ug.kbId}</span>}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <span className="font-mono text-sm text-zinc-400 bg-zinc-800 px-2 py-1 rounded">{un.installedVersion}</span>
          <ArrowRight className="w-4 h-4 text-emerald-500" />
          <span className="font-mono text-sm text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">{un.availableVersion}</span>
        </div>
      </div>
    </div>
  );
}

function DeploymentDetailPanel({ detail, onClose, onVerify }: { detail: DeploymentStatus; onClose: () => void; onVerify: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Rocket className="w-5 h-5 text-emerald-500" />
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{detail.name}</h2>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              detail.status === 'completed' ? 'bg-green-500/20 text-green-400' :
              detail.status === 'failed' ? 'bg-red-500/20 text-red-400' :
              detail.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
              'bg-zinc-700 text-zinc-400'
            }`}>{detail.status}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
      </div>

      {/* Progress */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
          <span>Progress</span>
          <span>{detail.progress.completed + detail.progress.failed}/{detail.progress.total}</span>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-2 mb-3">
          <div className="h-2 rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${detail.progress.total > 0 ? ((detail.progress.completed + detail.progress.failed) / detail.progress.total * 100) : 0}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center"><span className="text-green-400 font-medium">{detail.progress.completed}</span><br /><span className="text-zinc-500">Completed</span></div>
          <div className="text-center"><span className="text-red-400 font-medium">{detail.progress.failed}</span><br /><span className="text-zinc-500">Failed</span></div>
          <div className="text-center"><span className="text-zinc-300 font-medium">{detail.progress.pending}</span><br /><span className="text-zinc-500">Pending</span></div>
        </div>
      </div>

      {/* Per-node results */}
      <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Node Results</div>
      <div className="space-y-1 mb-6">
        {detail.results.map(r => (
          <div key={r.nodeId} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
            {r.status === 'pending' ? <Circle className="w-3 h-3 text-zinc-500" /> :
             r.status === 'running' || r.status === 'installing' ? <Loader2 className="w-3 h-3 animate-spin text-blue-400" /> :
             r.status === 'installed' || r.status === 'completed' ? <Check className="w-3 h-3 text-green-400" /> :
             r.status === 'failed' ? <X className="w-3 h-3 text-red-400" /> :
             <Circle className="w-3 h-3 text-zinc-500" />}
            <span className="font-mono text-sm text-zinc-300 flex-1">{r.hostname || r.nodeId}</span>
            <span className={`text-xs ${
              r.status === 'installed' || r.status === 'completed' ? 'text-green-400' :
              r.status === 'failed' ? 'text-red-400' :
              r.status === 'running' || r.status === 'installing' ? 'text-blue-400' :
              'text-zinc-500'
            }`}>{r.status}</span>
            {r.errorMessage && <span className="text-red-400 text-[10px] truncate max-w-[200px]" title={r.errorMessage}>{r.errorMessage}</span>}
          </div>
        ))}
      </div>

      {/* Verify button */}
      {detail.progress.pending === 0 && (
        <button onClick={onVerify}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Search className="w-4 h-4" /> Verify Deployment
        </button>
      )}
    </div>
  );
}
