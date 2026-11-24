/**
 * Load thresholds of the dashboard's Fleet performance list: above 70 % a metric is a warning,
 * above 85 % critical. The row links to the node's Performance tab with the worst metric marked.
 */
export const PERF_METRICS = ["cpu", "ram", "disk"] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];
export type PerfLevel = "ok" | "warn" | "crit";

export const WARN_PERCENT = 70;
export const CRIT_PERCENT = 85;

export function perfLevel(value: number): PerfLevel {
  return value > CRIT_PERCENT ? "crit" : value > WARN_PERCENT ? "warn" : "ok";
}

/** The highest of the three values (CPU wins a tie, then RAM) with its level */
export function worstMetric(values: Record<PerfMetric, number>): { metric: PerfMetric; value: number; level: PerfLevel } {
  const metric = PERF_METRICS.reduce((a, b) => (values[b] > values[a] ? b : a));
  return { metric, value: values[metric], level: perfLevel(values[metric]) };
}

/** The node's Performance tab, with the metric marked when it is above a threshold */
export function performanceHref(nodeId: string, worst: { metric: PerfMetric; level: PerfLevel }): string {
  const base = `/nodes/${encodeURIComponent(nodeId)}?tab=performance`;
  return worst.level === "ok" ? base : `${base}&highlight=${worst.metric}`;
}

export function isPerfMetric(value: string | null | undefined): value is PerfMetric {
  return (PERF_METRICS as readonly string[]).includes(value ?? "");
}
