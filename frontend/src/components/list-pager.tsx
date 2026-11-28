"use client";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-context";
import { formatNumber } from "@/lib/format";

/** Rows per page of the lists that can grow to thousands (groups, tags) */
export const PAGE_SIZE = 50;

/** Every word of the query appears in the text (any order and case) */
export function matchesWords(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The search field above such a list */
export function ListSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={label}
        className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm" />
    </div>
  );
}

/** "51-100 of 3,000" with Previous and Next; nothing when everything fits on one page */
export function ListPager({ page, total, onPage, size = PAGE_SIZE }: { page: number; total: number; onPage: (page: number) => void; size?: number }) {
  const { t } = useI18n();
  if (total <= size) return null;
  const pages = Math.ceil(total / size);
  const from = page * size + 1, to = Math.min(total, (page + 1) * size);
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
      <span aria-live="polite">{t("listPager.range", { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}</span>
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>{t("common.previous")}</Button>
      <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>{t("common.next")}</Button>
    </div>
  );
}
