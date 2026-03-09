"use client"

import { AlertCircle, Loader2, RefreshCw } from "lucide-react"

interface StandardPageProps {
  title: string
  description?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  filters?: React.ReactNode
  children: React.ReactNode
  sidebar?: React.ReactNode
  loading?: boolean
  error?: string
  onRetry?: () => void
}

export function StandardPage({
  title,
  description,
  icon,
  actions,
  filters,
  children,
  sidebar,
  loading,
  error,
  onRetry,
}: StandardPageProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-zinc-800" />
            <div className="h-8 w-48 rounded bg-zinc-800" />
          </div>
          <div className="h-9 w-32 rounded bg-zinc-800" />
        </div>
        <div className="h-10 w-full rounded bg-zinc-800" />
        <div className="flex-1 h-64 rounded bg-zinc-800" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 min-h-[400px]">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <p className="text-zinc-400 text-center max-w-md">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6 min-h-0 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          {icon && <span className="text-zinc-400">{icon}</span>}
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">{title}</h1>
            {description && (
              <p className="text-sm text-zinc-400 mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Filters */}
      {filters && <div>{filters}</div>}

      {/* Content + Sidebar */}
      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 min-w-0">{children}</div>
        {sidebar && (
          <aside className="hidden lg:block w-80 shrink-0">{sidebar}</aside>
        )}
      </div>
    </div>
  )
}
