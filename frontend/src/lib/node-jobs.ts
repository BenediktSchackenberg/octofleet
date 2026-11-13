import { apiClient } from "@/lib/api-client";

export type NodeJobResult =
  | { status: "success"; output?: string }
  | { status: "failed"; detail?: string }
  | { status: "timeout" }
  | { status: "notCreated" };

interface NodeJob {
  name: string;
  commandType: string;
  commandData?: Record<string, unknown>;
  /** The agent's time limit for the job (the server's default otherwise) */
  timeoutSeconds?: number;
}

/**
 * Creates a job for one node and waits until its agent reports the result, polling every 5 s for up
 * to `waitMs` (agents pick up jobs about once a minute). "notCreated" when the job cannot be created,
 * e.g. without the jobs:create permission.
 */
export async function runNodeJob(nodeUuid: string, job: NodeJob, waitMs: number): Promise<NodeJobResult> {
  let created: { id?: string } | null;
  try {
    created = await apiClient.post<{ id?: string }>(`/jobs`, {
      name: job.name,
      targetType: "device",
      targetId: nodeUuid,
      commandType: job.commandType,
      commandData: job.commandData ?? {},
      ...(job.timeoutSeconds ? { timeoutSeconds: job.timeoutSeconds } : {}),
    }, { showErrorToast: false });
  } catch {
    return { status: "notCreated" };
  }
  if (!created?.id) return { status: "notCreated" };

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    try {
      const state = await apiClient.get<{ instances?: { status?: string; stderr?: string; stdout?: string }[] }>(
        `/jobs/${created.id}`, { showErrorToast: false });
      const instance = state?.instances?.[0];
      if (instance?.status === "success") return { status: "success", output: instance.stdout || undefined };
      if (instance?.status === "failed" || instance?.status === "cancelled") {
        return { status: "failed", detail: instance.stderr || instance.stdout || undefined };
      }
    } catch {
      // a failed poll (network, server restart): try again until the deadline
    }
  }
  return { status: "timeout" };
}
