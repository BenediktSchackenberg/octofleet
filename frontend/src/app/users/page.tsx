"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { Plus, Trash2, Shield, User as UserIcon, Key } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080";

interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
  last_login: string | null;
  roles: string[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
}

function getAuthHeader() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) return { Authorization: `Bearer ${token}` };
  return { "X-API-Key": "openclaw-inventory-dev-key" };
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", email: "", display_name: "" });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/users`, { headers: getAuthHeader() }),
        fetch(`${API_URL}/api/v1/roles`, { headers: getAuthHeader() }),
      ]);
      
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
      if (rolesRes.ok) {
        const data = await rolesRes.json();
        setRoles(data.roles || []);
      }
    } catch (e) {
      console.error("Failed to fetch users:", e);
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    try {
      const res = await fetch(`${API_URL}/api/v1/users`, {
        method: "POST",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewUser({ username: "", password: "", email: "", display_name: "" });
        fetchData();
      }
    } catch (e) {
      console.error("Failed to create user:", e);
    }
  }

  async function deleteUser(userId: string) {
    if (!confirm("Delete this user?")) return;
    try {
      await fetch(`${API_URL}/api/v1/users/${userId}`, {
        method: "DELETE",
        headers: getAuthHeader(),
      });
      fetchData();
    } catch (e) {
      console.error("Failed to delete user:", e);
    }
  }

  async function toggleRole(userId: string, roleName: string, hasRole: boolean) {
    try {
      await fetch(`${API_URL}/api/v1/users/${userId}/roles/${roleName}`, {
        method: hasRole ? "DELETE" : "POST",
        headers: getAuthHeader(),
      });
      fetchData();
    } catch (e) {
      console.error("Failed to toggle role:", e);
    }
  }

  async function toggleActive(userId: string, isActive: boolean) {
    try {
      await fetch(`${API_URL}/api/v1/users/${userId}`, {
        method: "PUT",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !isActive }),
      });
      fetchData();
    } catch (e) {
      console.error("Failed to toggle user status:", e);
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
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Breadcrumb items={[{ label: "Users" }]} />
        <h1 className="text-2xl font-bold mb-6">👥 User Management</h1>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <Breadcrumb items={[{ label: "Users" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">👥 User Management</h1>
          <p className="text-muted-foreground">{users.length} users</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create User
        </Button>
      </div>

      {/* Create User Modal */}
      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New User</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Username *</label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="john.doe"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Password *</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Display Name</label>
                <input
                  type="text"
                  value={newUser.display_name}
                  onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="John Doe"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={createUser} disabled={!newUser.username || !newUser.password}>
                Create User
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users Table */}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{user.display_name || user.username}</div>
                        <div className="text-xs text-muted-foreground">@{user.username}</div>
                      </div>
                      {user.is_superuser && (
                        <Badge variant="default" className="ml-2">Super</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {roles.map((role) => {
                        const hasRole = user.roles.includes(role.name);
                        return (
                          <Badge
                            key={role.name}
                            variant={hasRole ? "default" : "outline"}
                            className={`cursor-pointer ${hasRole ? "" : "opacity-50"}`}
                            onClick={() => toggleRole(user.id, role.name, hasRole)}
                          >
                            {role.name}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={user.is_active ? "default" : "destructive"}
                      className="cursor-pointer"
                      onClick={() => toggleActive(user.id, user.is_active)}
                    >
                      {user.is_active ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(user.last_login)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteUser(user.id)}
                      className="text-red-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Roles Overview */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Roles & Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {roles.map((role) => (
              <div key={role.id} className="p-4 bg-secondary rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{role.name}</h3>
                  {role.is_system && <Badge variant="outline">System</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mb-2">{role.description}</p>
                <div className="flex flex-wrap gap-1">
                  {role.permissions.slice(0, 5).map((perm) => (
                    <Badge key={perm} variant="secondary" className="text-xs">
                      {perm}
                    </Badge>
                  ))}
                  {role.permissions.length > 5 && (
                    <Badge variant="secondary" className="text-xs">
                      +{role.permissions.length - 5} more
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
