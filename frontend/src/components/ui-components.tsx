"use client";

import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-2 text-sm text-zinc-400 mb-4">
      <Link href="/" className="hover:text-blue-400 transition-colors">
        🏠 Home
      </Link>
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-2">
          <span className="text-zinc-600">/</span>
          {item.href ? (
            <Link href={item.href} className="hover:text-blue-400 transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-zinc-200">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ 
  title, 
  subtitle, 
  icon,
  action 
}: { 
  title: string; 
  subtitle?: string; 
  icon?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          {icon && <span>{icon}</span>}
          {title}
        </h1>
        {subtitle && <p className="text-zinc-400 text-sm mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "h-4 w-4 border-2",
    md: "h-8 w-8 border-2",
    lg: "h-12 w-12 border-4",
  };
  
  return (
    <div className={`animate-spin rounded-full border-blue-500 border-t-transparent ${sizes[size]}`} />
  );
}

export function LoadingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

export function EmptyState({ 
  icon, 
  title, 
  description, 
  action 
}: { 
  icon: string; 
  title: string; 
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12">
      <div className="text-6xl mb-4">{icon}</div>
      <h2 className="text-xl font-semibold text-white mb-2">{title}</h2>
      {description && <p className="text-zinc-400 mb-4">{description}</p>}
      {action}
    </div>
  );
}

export function Card({ 
  children, 
  className = "" 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={`bg-zinc-900 rounded-lg border border-zinc-800 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ 
  children, 
  className = "" 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={`p-4 border-b border-zinc-800 ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({ 
  children, 
  className = "" 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={`p-4 ${className}`}>
      {children}
    </div>
  );
}

export function StatusDot({ status }: { status: "online" | "offline" | "away" | "unknown" }) {
  const colors = {
    online: "bg-green-500",
    offline: "bg-zinc-500",
    away: "bg-yellow-500",
    unknown: "bg-zinc-600",
  };
  
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />
  );
}

export function Badge({ 
  children, 
  variant = "default" 
}: { 
  children: React.ReactNode; 
  variant?: "default" | "success" | "warning" | "error" | "info";
}) {
  const variants = {
    default: "bg-zinc-700 text-zinc-300",
    success: "bg-green-500/20 text-green-400",
    warning: "bg-yellow-500/20 text-yellow-400",
    error: "bg-red-500/20 text-red-400",
    info: "bg-blue-500/20 text-blue-400",
  };
  
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
}
