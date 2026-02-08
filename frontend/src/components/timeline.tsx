'use client';

import { Badge } from "@/components/ui/badge";

interface InventoryChange {
  id: number;
  category: string;
  changeType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

interface TimelineProps {
  changes: InventoryChange[];
}

function getChangeIcon(changeType: string) {
  switch (changeType) {
    case 'added':
      return '➕';
    case 'removed':
      return '➖';
    case 'changed':
      return '🔄';
    case 'snapshot':
      return '📷';
    default:
      return '📝';
  }
}

function getChangeBadgeVariant(changeType: string): "default" | "secondary" | "destructive" | "outline" {
  switch (changeType) {
    case 'added':
      return 'default';
    case 'removed':
      return 'destructive';
    case 'changed':
    case 'snapshot':
      return 'secondary';
    default:
      return 'outline';
  }
}

function getChangeLabel(changeType: string): string {
  switch (changeType) {
    case 'added':
      return 'Hinzugefügt';
    case 'removed':
      return 'Entfernt';
    case 'changed':
      return 'Geändert';
    case 'snapshot':
      return 'Snapshot';
    default:
      return changeType;
  }
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'hardware': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'full': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'software': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    'security': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    'network': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'system': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    'browser': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'hotfix': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  };
  return colors[category.toLowerCase()] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    'full': 'Hardware',
    'hardware': 'Hardware',
    'software': 'Software',
    'security': 'Sicherheit',
    'network': 'Netzwerk',
    'system': 'System',
    'browser': 'Browser',
    'hotfix': 'Updates',
  };
  return labels[category.toLowerCase()] || category;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'Gerade eben';
  if (diffMins < 60) return `vor ${diffMins} Min.`;
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  if (diffDays < 7) return `vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`;
  
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function truncateValue(value: string | null, maxLength: number = 80): string {
  if (!value) return '-';
  // Remove JSON escape sequences for display
  const cleaned = value.replace(/\\"/g, '"').replace(/^"|"$/g, '');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}

function groupChangesByDate(changes: InventoryChange[]): Map<string, InventoryChange[]> {
  const grouped = new Map<string, InventoryChange[]>();
  
  for (const change of changes) {
    const date = new Date(change.detectedAt).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(change);
  }
  
  return grouped;
}

export function Timeline({ changes }: TimelineProps) {
  const groupedChanges = groupChangesByDate(changes);
  
  return (
    <div className="space-y-8">
      {Array.from(groupedChanges.entries()).map(([date, dateChanges]) => (
        <div key={date}>
          {/* Date Header */}
          <div className="sticky top-0 bg-background/95 backdrop-blur py-2 mb-4 z-10">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {date}
            </h3>
          </div>
          
          {/* Changes for this date */}
          <div className="space-y-4">
            {dateChanges.map((change, index) => (
              <div 
                key={change.id || index}
                className="relative pl-6 pb-4 border-l-2 border-border last:border-l-transparent"
              >
                {/* Timeline dot */}
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-background border-2 border-primary flex items-center justify-center text-xs">
                  {getChangeIcon(change.changeType)}
                </div>
                
                {/* Change content */}
                <div className="bg-card border rounded-lg p-4 hover:shadow-md transition-shadow">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={getCategoryColor(change.category)}>
                        {getCategoryLabel(change.category)}
                      </Badge>
                      <Badge variant={getChangeBadgeVariant(change.changeType)}>
                        {getChangeLabel(change.changeType)}
                      </Badge>
                    </div>
                    <span 
                      className="text-xs text-muted-foreground whitespace-nowrap"
                      title={formatDateTime(change.detectedAt)}
                    >
                      {formatRelativeTime(change.detectedAt)}
                    </span>
                  </div>
                  
                  {/* Field name if present */}
                  {change.fieldName && (
                    <p className="font-medium mb-2">{change.fieldName}</p>
                  )}
                  
                  {/* Value changes */}
                  <div className="text-sm space-y-1">
                    {change.changeType === 'changed' && (
                      <>
                        {change.oldValue && (
                          <div className="flex items-start gap-2">
                            <span className="text-muted-foreground min-w-[40px]">Alt:</span>
                            <code className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 px-2 py-0.5 rounded text-xs break-all">
                              {truncateValue(change.oldValue)}
                            </code>
                          </div>
                        )}
                        {change.newValue && (
                          <div className="flex items-start gap-2">
                            <span className="text-muted-foreground min-w-[40px]">Neu:</span>
                            <code className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 px-2 py-0.5 rounded text-xs break-all">
                              {truncateValue(change.newValue)}
                            </code>
                          </div>
                        )}
                      </>
                    )}
                    {change.changeType === 'added' && change.newValue && (
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground min-w-[40px]">Wert:</span>
                        <code className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 px-2 py-0.5 rounded text-xs break-all">
                          {truncateValue(change.newValue)}
                        </code>
                      </div>
                    )}
                    {change.changeType === 'removed' && change.oldValue && (
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground min-w-[40px]">War:</span>
                        <code className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 px-2 py-0.5 rounded text-xs break-all">
                          {truncateValue(change.oldValue)}
                        </code>
                      </div>
                    )}
                    {change.changeType === 'snapshot' && change.newValue && (
                      <div className="text-muted-foreground text-xs">
                        Vollständiger Hardware-Snapshot aufgezeichnet
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
