interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
}
export function PageHeader({ title, description, actions, filters }: PageHeaderProps) {
  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
          {description && <p className="text-sm text-[var(--text-secondary)] mt-1">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}
    </div>
  );
}
