const STATUS_STYLES: Record<string, string> = {
  success: 'bg-[var(--status-success-bg)] text-emerald-400 border-emerald-500/20',
  warning: 'bg-[var(--status-warning-bg)] text-amber-400 border-amber-500/20',
  danger: 'bg-[var(--status-danger-bg)] text-red-400 border-red-500/20',
  info: 'bg-[var(--status-info-bg)] text-blue-400 border-blue-500/20',
  neutral: 'bg-zinc-800/50 text-zinc-400 border-zinc-700',
};

interface StatusBadgeProps { variant: string; children: React.ReactNode; dot?: boolean; }

export function StatusBadge({ variant, children, dot }: StatusBadgeProps) {
  const style = STATUS_STYLES[variant] || STATUS_STYLES.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full border ${style}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function statusToVariant(status: string): string {
  const s = status.toLowerCase();
  if (['online','success','completed','active','healthy','fixed','compliant'].includes(s)) return 'success';
  if (['warning','pending','queued','running','drift'].includes(s)) return 'warning';
  if (['offline','error','failed','critical','danger','non_compliant'].includes(s)) return 'danger';
  if (['info','unknown','new'].includes(s)) return 'info';
  return 'neutral';
}
