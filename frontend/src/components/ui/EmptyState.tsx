import { LucideIcon } from 'lucide-react';

interface EmptyStateProps { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode; }

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Icon className="w-12 h-12 text-zinc-600" />
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
      {description && <p className="text-sm text-[var(--text-secondary)] max-w-sm text-center">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
