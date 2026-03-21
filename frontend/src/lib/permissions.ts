export const PERMISSION_CATEGORIES: Record<string, { label: string; permissions: string[] }> = {
  nodes: { label: "Nodes", permissions: ["nodes:read", "nodes:write", "nodes:assign"] },
  groups: { label: "Groups", permissions: ["groups:read", "groups:write"] },
  jobs: { label: "Jobs", permissions: ["jobs:read", "jobs:create", "jobs:execute", "jobs:cancel"] },
  packages: { label: "Packages", permissions: ["packages:read", "packages:write", "packages:deploy"] },
  deployments: { label: "Deployments", permissions: ["deployments:read", "deployments:write"] },
  alerts: { label: "Alerts", permissions: ["alerts:read", "alerts:write"] },
  eventlog: { label: "Event Log", permissions: ["eventlog:read"] },
  compliance: { label: "Compliance", permissions: ["compliance:read"] },
  settings: { label: "Settings", permissions: ["settings:read", "settings:write"] },
  users: { label: "Users", permissions: ["users:read", "users:write"] },
  roles: { label: "Roles", permissions: ["roles:read", "roles:write"] },
  reports: { label: "Reports", permissions: ["reports:read", "reports:write"] },
  audit: { label: "Audit", permissions: ["audit:read"] },
  security: { label: "Security", permissions: ["security:read", "security:write"] },
  terminal: { label: "Terminal", permissions: ["terminal:access"] },
};

export const ALL_PERMISSIONS = Object.values(PERMISSION_CATEGORIES).flatMap(c => c.permissions);
