/**
 * The window of the open tasks: failed jobs, remediations and alert deliveries of the last 7 days.
 * The Tasks page, the dashboard's "Open tasks" and the sidebar badges count the same way, so their
 * numbers match.
 */
export const TASK_WINDOW_HOURS = 7 * 24;

/** Failed jobs within the window (GET /jobs returns their `total`) */
export const FAILED_JOBS_PATH = `/jobs?status=failed&since_hours=${TASK_WINDOW_HOURS}`;

export function withinTaskWindow(iso: string | null | undefined): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() <= TASK_WINDOW_HOURS * 3600_000;
}
