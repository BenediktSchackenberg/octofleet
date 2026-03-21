"use client";

import { apiClient } from "@/lib/api-client";
import { PERMISSION_CATEGORIES } from "@/lib/permissions";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/ui-components";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Users, ScrollText, Lock, Unlock, Plus, Pencil, Trash2,
  Search, Filter, Download, ChevronRight, User as UserIcon, Eye, X
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  createdAt: string;
  lastLogin: string | null;
  roles: string[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount?: number;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string | null;
  username: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

interface ScopeEntry {
  id: string;
  roleId: string;
  roleName: string;
  groupId: string | null;
  groupName: string | null;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Permission Picker Component ─────────────────────────────────────

function PermissionPicker({ selected, onChange }: { selected: string[]; onChange: (p: string[]) => void }) {
  const toggle = (perm: string) => {
    onChange(selected.includes(perm) ? selected.filter(p => p !== perm) : [...selected, perm]);
  };
  const toggleCategory = (perms: string[]) => {
    const allSelected = perms.every(p => selected.includes(p));
    if (allSelected) {
      onChange(selected.filter(p => !perms.includes(p)));
    } else {
      onChange([...new Set([...selected, ...perms])]);
    }
  };

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
      {Object.entries(PERMISSION_CATEGORIES).map(([key, cat]) => (
        <div key={key} className="space-y-1">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => toggleCategory(cat.permissions)}
          >
            <Checkbox
              checked={cat.permissions.every(p => selected.includes(p))}
              className="pointer-events-none"
            />
            <span className="text-sm font-medium">{cat.label}</span>
          </div>
          <div className="ml-6 flex flex-wrap gap-1">
            {cat.permissions.map(perm => (
              <Badge
                key={perm}
                variant={selected.includes(perm) ? "default" : "outline"}
                className="cursor-pointer text-xs"
                onClick={() => toggle(perm)}
              >
                {perm.split(":")[1]}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Main Page
// ═════════════════════════════════════════════════════════════════════

export default function UsersPage() {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        apiClient.get<{ users: User[] }>("/users", { camelCase: true, showErrorToast: false }),
        apiClient.get<{ roles: Role[] }>("/roles", { camelCase: true, showErrorToast: false }),
      ]);
      if (usersRes) setUsers(usersRes.users || []);
      if (rolesRes) setRoles(rolesRes.roles || []);
    } catch (e) {
      console.error("Fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <h1 className="text-2xl font-bold mb-6">Access Management</h1>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Access Management</h1>
        <p className="text-muted-foreground">Users, roles & permissions, audit log</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="users" className="gap-2"><Users className="h-4 w-4" /> Users</TabsTrigger>
          <TabsTrigger value="roles" className="gap-2"><Shield className="h-4 w-4" /> Roles</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2"><ScrollText className="h-4 w-4" /> Audit Log</TabsTrigger>
        </TabsList>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
            <TabsContent value="users" forceMount={tab === "users" ? true : undefined} className={tab !== "users" ? "hidden" : ""}>
              <UsersTab users={users} roles={roles} refresh={fetchData} />
            </TabsContent>
            <TabsContent value="roles" forceMount={tab === "roles" ? true : undefined} className={tab !== "roles" ? "hidden" : ""}>
              <RolesTab roles={roles} refresh={fetchData} />
            </TabsContent>
            <TabsContent value="audit" forceMount={tab === "audit" ? true : undefined} className={tab !== "audit" ? "hidden" : ""}>
              <AuditTab />
            </TabsContent>
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Tab 1: Users
// ═════════════════════════════════════════════════════════════════════

function UsersTab({ users, roles, refresh }: { users: User[]; roles: Role[]; refresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", email: "", display_name: "" });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<string>("username");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = users
    .filter(u => !search || u.username.toLowerCase().includes(search.toLowerCase()) || (u.displayName || "").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] ?? "";
      const bv = (b as unknown as Record<string, unknown>)[sortField] ?? "";
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  async function createUser() {
    const res = await apiClient.post("/users", newUser, { showErrorToast: true });
    if (res) {
      toast.success("User created");
      setShowCreate(false);
      setNewUser({ username: "", password: "", email: "", display_name: "" });
      refresh();
    }
  }

  async function deleteUser(userId: string) {
    if (!confirm("Delete this user?")) return;
    const res = await apiClient.delete(`/users/${userId}`);
    if (res) { toast.success("User deleted"); refresh(); }
  }

  async function toggleActive(userId: string, isActive: boolean) {
    await apiClient.put(`/users/${userId}`, { is_active: !isActive });
    toast.success(isActive ? "User disabled" : "User enabled");
    refresh();
  }

  async function assignRole(userId: string, roleName: string) {
    await apiClient.post(`/users/${userId}/roles/${roleName}`, {});
    toast.success(`Role "${roleName}" assigned`);
    refresh();
  }

  async function removeRole(userId: string, roleName: string) {
    await apiClient.delete(`/users/${userId}/roles/${roleName}`);
    toast.success(`Role "${roleName}" removed`);
    refresh();
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Create User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>Add a new user account.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Username *</Label>
                <Input value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} placeholder="john.doe" />
              </div>
              <div className="grid gap-2">
                <Label>Password *</Label>
                <Input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="john@example.com" />
              </div>
              <div className="grid gap-2">
                <Label>Display Name</Label>
                <Input value={newUser.display_name} onChange={e => setNewUser({ ...newUser, display_name: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={createUser} disabled={!newUser.username || !newUser.password}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Users Table */}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("username")}>User {sortField === "username" && (sortDir === "asc" ? "↑" : "↓")}</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("isActive")}>Status</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("lastLogin")}>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(user => (
                <TableRow key={user.id} className="cursor-pointer" onClick={() => setSelectedUser(user)}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{user.displayName || user.username}</div>
                        <div className="text-xs text-muted-foreground">@{user.username}</div>
                      </div>
                      {user.isSuperuser && <Badge variant="default" className="ml-2">Super</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map(r => <Badge key={r} variant="default" className="text-xs">{r}</Badge>)}
                      {user.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "default" : "destructive"} className="cursor-pointer" onClick={e => { e.stopPropagation(); toggleActive(user.id, user.isActive); }}>
                      {user.isActive ? <><Unlock className="h-3 w-3 mr-1" />Active</> : <><Lock className="h-3 w-3 mr-1" />Disabled</>}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(user.lastLogin)}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedUser(user)}><Eye className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteUser(user.id)} className="text-red-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* User Detail Sheet */}
      <Sheet open={!!selectedUser} onOpenChange={open => { if (!open) setSelectedUser(null); }}>
        <SheetContent className="w-[480px] sm:max-w-lg overflow-y-auto">
          {selectedUser && (
            <UserDetailPanel user={selectedUser} roles={roles} refresh={() => { refresh(); setSelectedUser(null); }} assignRole={assignRole} removeRole={removeRole} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function UserDetailPanel({ user, roles, refresh, assignRole, removeRole }: {
  user: User; roles: Role[]; refresh: () => void;
  assignRole: (uid: string, role: string) => void;
  removeRole: (uid: string, role: string) => void;
}) {
  const [scopes, setScopes] = useState<ScopeEntry[]>([]);

  useEffect(() => {
    apiClient.get<{ scopes: ScopeEntry[] }>(`/users/${user.id}/scopes`, { camelCase: true, showErrorToast: false })
      .then(r => { if (r) setScopes(r.scopes || []); });
  }, [user.id]);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <UserIcon className="h-5 w-5" /> {user.displayName || user.username}
        </SheetTitle>
      </SheetHeader>
      <div className="mt-6 space-y-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Username</span><p className="font-medium">@{user.username}</p></div>
          <div><span className="text-muted-foreground">Email</span><p className="font-medium">{user.email || "—"}</p></div>
          <div><span className="text-muted-foreground">Status</span><p>{user.isActive ? "Active" : "Disabled"}</p></div>
          <div><span className="text-muted-foreground">Created</span><p>{formatDate(user.createdAt)}</p></div>
          <div><span className="text-muted-foreground">Last Login</span><p>{formatDate(user.lastLogin)}</p></div>
        </div>

        {/* Global Roles */}
        <div>
          <h3 className="text-sm font-medium mb-2">Global Roles</h3>
          <div className="flex flex-wrap gap-2">
            {roles.map(role => {
              const has = user.roles.includes(role.name);
              return (
                <Badge
                  key={role.id}
                  variant={has ? "default" : "outline"}
                  className={`cursor-pointer ${has ? "" : "opacity-50"}`}
                  onClick={() => has ? removeRole(user.id, role.name) : assignRole(user.id, role.name)}
                >
                  {has ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                  {role.name}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Scoped Roles */}
        {scopes.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">Scoped Roles</h3>
            <div className="space-y-2">
              {scopes.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-secondary rounded-md px-3 py-2 text-sm">
                  <div>
                    <Badge variant="default" className="mr-2">{s.roleName}</Badge>
                    {s.groupName ? <span className="text-muted-foreground">→ {s.groupName}</span> : <span className="text-muted-foreground">Global</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Tab 2: Roles
// ═════════════════════════════════════════════════════════════════════

function RolesTab({ roles, refresh }: { roles: Role[]; refresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState({ name: "", description: "", permissions: [] as string[] });
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [roleUsers, setRoleUsers] = useState<{ id: string; username: string; displayName: string | null }[]>([]);

  useEffect(() => {
    if (editRole) {
      setEditPerms(editRole.permissions || []);
      setEditName(editRole.name);
      setEditDesc(editRole.description || "");
      apiClient.get<{ users: { id: string; username: string; displayName: string | null }[] }>(`/roles/${editRole.id}/users`, { camelCase: true, showErrorToast: false })
        .then(r => { if (r) setRoleUsers(r.users || []); });
    }
  }, [editRole]);

  async function createRole() {
    const res = await apiClient.post("/roles", { name: newRole.name, description: newRole.description, permissions: newRole.permissions });
    if (res) {
      toast.success("Role created");
      setShowCreate(false);
      setNewRole({ name: "", description: "", permissions: [] });
      refresh();
    }
  }

  async function updateRole() {
    if (!editRole) return;
    const res = await apiClient.put(`/roles/${editRole.id}`, { name: editName, description: editDesc, permissions: editPerms });
    if (res) {
      toast.success("Role updated");
      setEditRole(null);
      refresh();
    }
  }

  async function deleteRole(roleId: string) {
    if (!confirm("Delete this role?")) return;
    const res = await apiClient.delete(`/roles/${roleId}`);
    if (res) { toast.success("Role deleted"); refresh(); }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{roles.length} roles</p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Create Role</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Role</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2"><Label>Name *</Label><Input value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Description</Label><Input value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Permissions</Label>
                <PermissionPicker selected={newRole.permissions} onChange={p => setNewRole({ ...newRole, permissions: p })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={createRole} disabled={!newRole.name}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map(role => (
          <Card key={role.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => !role.isSystem && setEditRole(role)}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" /> {role.name}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {role.isSystem && <Badge variant="outline">System</Badge>}
                  {!role.isSystem && (
                    <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); deleteRole(role.id); }} className="text-red-500 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <CardDescription>{role.description || "No description"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {(role.permissions || []).slice(0, 6).map(p => <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>)}
                {(role.permissions || []).length > 6 && <Badge variant="secondary" className="text-xs">+{role.permissions.length - 6} more</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Role Sheet */}
      <Sheet open={!!editRole} onOpenChange={open => { if (!open) setEditRole(null); }}>
        <SheetContent className="w-[500px] sm:max-w-xl overflow-y-auto">
          {editRole && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit Role: {editRole.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="grid gap-2"><Label>Name</Label><Input value={editName} onChange={e => setEditName(e.target.value)} /></div>
                <div className="grid gap-2"><Label>Description</Label><Input value={editDesc} onChange={e => setEditDesc(e.target.value)} /></div>
                <div className="grid gap-2">
                  <Label>Permissions ({editPerms.length})</Label>
                  <PermissionPicker selected={editPerms} onChange={setEditPerms} />
                </div>
                <Button onClick={updateRole} className="w-full">Save Changes</Button>

                {roleUsers.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Users with this role ({roleUsers.length})</h3>
                    <div className="space-y-1">
                      {roleUsers.map(u => (
                        <div key={u.id} className="flex items-center gap-2 text-sm bg-secondary rounded px-3 py-1.5">
                          <UserIcon className="h-3 w-3" /> {u.displayName || u.username}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Tab 3: Audit Log
// ═════════════════════════════════════════════════════════════════════

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const limit = 50;

  const fetchAudit = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));
    if (actionFilter) params.set("action", actionFilter);
    if (resourceFilter) params.set("resource_type", resourceFilter);

    const res = await apiClient.get<{ total: number; entries: AuditEntry[] }>(`/audit-log?${params}`, { camelCase: true, showErrorToast: false });
    if (res) {
      setEntries(res.entries || []);
      setTotal(res.total || 0);
    }
    setLoading(false);
  }, [page, actionFilter, resourceFilter]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(fetchAudit, 10000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchAudit]);

  function exportCsv() {
    const header = "Timestamp,User,Action,Resource Type,Resource ID,IP\n";
    const rows = entries.map(e => `${e.timestamp},${e.username || ""},${e.action},${e.resourceType},${e.resourceId || ""},${e.ipAddress || ""}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "audit-log.csv"; a.click();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Input placeholder="Filter action..." value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(0); }} className="w-48" />
          <Input placeholder="Filter resource type..." value={resourceFilter} onChange={e => { setResourceFilter(e.target.value); setPage(0); }} className="w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? "⏸ Auto" : "▶ Auto"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Resource ID</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(e => (
                    <>
                      <TableRow key={e.id} className="cursor-pointer" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(e.timestamp)}</TableCell>
                        <TableCell className="text-sm">{e.username || "system"}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{e.action}</Badge></TableCell>
                        <TableCell className="text-sm">{e.resourceType}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">{e.resourceId || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.ipAddress || "—"}</TableCell>
                        <TableCell><ChevronRight className={`h-4 w-4 transition-transform ${expanded === e.id ? "rotate-90" : ""}`} /></TableCell>
                      </TableRow>
                      {expanded === e.id && e.details && (
                        <TableRow key={`${e.id}-detail`}>
                          <TableCell colSpan={7}>
                            <pre className="text-xs bg-secondary p-3 rounded-md overflow-x-auto max-h-48">{JSON.stringify(e.details, null, 2)}</pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                  {entries.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No audit entries found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">{total} total entries</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
