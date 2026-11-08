/**
 * Names of the app's pages, translated: used by the breadcrumb, "Recently opened" and the
 * command palette, so a page has the same name everywhere and follows the UI language.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Fixed pages → locale key (the sidebar's nav.* keys where there is one). */
const ROUTE_KEYS: Record<string, string> = {
  "/": "nav.dashboard",
  "/tasks": "nav.tasks",
  "/nodes": "nav.nodes",
  "/groups": "nav.groups",
  "/hardware": "nav.hardware",
  "/discovered-systems": "nav.discovered",
  "/packages": "nav.packages",
  "/repo": "nav.repo",
  "/deployments": "nav.deployments",
  "/jobs": "nav.jobs",
  "/metering": "nav.metering",
  "/software-compare": "nav.compare",
  "/security": "nav.securityCenter",
  "/security/findings": "nav.findings",
  "/security/events": "nav.securityEvents",
  "/security/profiles": "nav.monitoringProfiles",
  "/security/rules": "nav.behaviorRules",
  "/security/policies": "nav.securityPolicies",
  "/security/posture": "nav.configPosture",
  "/security/file-audit": "nav.fileAudit",
  "/security/audit-log": "nav.accessAudit",
  "/security/evidence": "nav.evidence",
  "/security/retention": "nav.retention",
  "/vulnerabilities": "nav.vulnerabilities",
  "/remediation": "nav.remediation",
  "/compliance": "nav.compliance",
  "/patches": "nav.patches",
  "/patches/explorer": "nav.patchExplorer",
  "/performance": "nav.performance",
  "/alerts": "nav.alerts",
  "/eventlog": "nav.eventlog",
  "/reports": "nav.reports",
  "/query": "nav.queryEngine",
  "/services": "nav.services",
  "/provisioning": "nav.provisioning",
  "/provisioning/admin": "routes.provisioningAdmin",
  "/content": "nav.contentLifecycle",
  "/sql": "nav.sql",
  "/users": "nav.users",
  "/audit": "nav.audit",
  "/api-keys": "nav.apiKeys",
  "/settings": "nav.settings",
  "/settings/provisioning": "routes.provisioningSettings",
  "/admin/agents": "nav.agentMonitor",
};

/** Detail pages: /<segment>/<id> → "Node {name}", "Group {name}" … */
const ENTITY_KEYS: Record<string, string> = {
  nodes: "routes.node",
  packages: "routes.package",
  deployments: "routes.deployment",
  jobs: "routes.job",
  groups: "routes.group",
  services: "routes.service",
};

/** Subpages of a detail page: /nodes/<id>/<subpage>. */
const SUBPAGE_KEYS: Record<string, string> = {
  live: "routes.live",
  screen: "nodeDetail.screen",
  shell: "routes.shell",
  terminal: "routes.terminal",
};

function humanize(segment: string): string {
  return decodeURIComponent(segment).replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Name of a page, e.g. "Nodes", "Node SRV-01" or "Node SRV-01 – Terminal". `name` is the entity's name if known. */
export function routeLabel(path: string, t: Translate, name?: string): string {
  const clean = path.split("?")[0];
  if (ROUTE_KEYS[clean]) return t(ROUTE_KEYS[clean]);
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) return t("nav.dashboard");
  const entityKey = ENTITY_KEYS[segments[0]];
  if (entityKey && segments[1]) {
    const label = t(entityKey, { name: name || decodeURIComponent(segments[1]) });
    if (!segments[2]) return label;
    const subKey = SUBPAGE_KEYS[segments[2]];
    return `${label} – ${subKey ? t(subKey) : humanize(segments[2])}`;
  }
  return humanize(segments[segments.length - 1]);
}

/** Label of one breadcrumb step; `href` is the path up to that step. */
export function crumbLabel(href: string, t: Translate, name?: string): string {
  if (ROUTE_KEYS[href]) return t(ROUTE_KEYS[href]);
  const segments = href.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  if (segments.length === 2 && ENTITY_KEYS[segments[0]]) return name || decodeURIComponent(last);
  if (segments.length === 3 && ENTITY_KEYS[segments[0]] && SUBPAGE_KEYS[last]) return t(SUBPAGE_KEYS[last]);
  return humanize(last);
}
