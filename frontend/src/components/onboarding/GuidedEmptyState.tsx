"use client";

import { useRouter } from "next/navigation";
import { Server, Zap, ShieldCheck, Package, Bell, FileText, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

interface PageConfig {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

const configs: Record<string, PageConfig> = {
  nodes: {
    icon: Server,
    title: "No devices connected yet",
    description: "Connect your first device using the agent installer. Download the agent package and run it on the target machine to begin managing it.",
    actionLabel: "Get agent installer",
    actionHref: "/api/v1/onboarding/agent-config",
    secondaryLabel: "Learn more",
    secondaryHref: "/docs/agents",
  },
  jobs: {
    icon: Zap,
    title: "No jobs created",
    description: "Jobs are created when you deploy patches, run scripts, or trigger remediation. Once you start managing devices, jobs will appear here.",
  },
  patches: {
    icon: ShieldCheck,
    title: "No patch rings configured",
    description: "Create your first patch ring to start managing Windows updates. Patch rings let you control update rollout across device groups.",
    actionLabel: "Create patch ring",
    actionHref: "/patches/new",
  },
  packages: {
    icon: Package,
    title: "No packages found",
    description: "Packages will appear here once devices report their installed software, or you can upload custom packages for deployment.",
  },
  alerts: {
    icon: Bell,
    title: "No alert rules configured",
    description: "Set up alert rules to get notified about critical events, performance thresholds, or security findings.",
    actionLabel: "Create alert rule",
    actionHref: "/alerts/new",
  },
  reports: {
    icon: FileText,
    title: "No reports generated",
    description: "Reports are generated from your fleet data. Connect devices and collect data to start generating compliance and status reports.",
  },
};

interface GuidedEmptyStateProps {
  page: string;
}

export function GuidedEmptyState({ page }: GuidedEmptyStateProps) {
  const router = useRouter();
  const config = configs[page];

  if (!config) {
    return (
      <EmptyState
        icon={Server}
        title="Nothing here yet"
        description="Get started by exploring the sidebar navigation."
      />
    );
  }

  return (
    <EmptyState
      icon={config.icon}
      title={config.title}
      description={config.description}
      actionLabel={config.actionLabel}
      onAction={config.actionHref ? () => router.push(config.actionHref!) : undefined}
      secondaryLabel={config.secondaryLabel}
      onSecondary={config.secondaryHref ? () => router.push(config.secondaryHref!) : undefined}
    />
  );
}
