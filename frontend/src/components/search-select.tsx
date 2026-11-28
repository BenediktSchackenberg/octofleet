"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";

export interface SearchOption { id: string; label: string; hint?: string; color?: string | null }

const SHOWN = 50;

/** A picker for long lists (hundreds of groups or tags): type to narrow it down - every word must
 *  appear in the label or hint, any order and case -, arrow keys and Enter to choose; at most 50 hits are
 *  listed with how many more there are. `label` should say which one it is (a group's path). */
export function SearchSelect({ options, value, onChange, placeholder, label, emptyText }: {
  options: SearchOption[]; value: string | null; onChange: (id: string | null) => void;
  placeholder: string; label: string; emptyText?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = options.find((o) => o.id === value) ?? null;

  const hits = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length === 0 ? options
      : options.filter((o) => { const text = `${o.label} ${o.hint ?? ""}`.toLowerCase(); return words.every((w) => text.includes(w)); });
  }, [options, query]);
  const shown = hits.slice(0, SHOWN);

  const choose = (o: SearchOption) => { onChange(o.id); setQuery(""); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); choose(shown[active]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="relative">
      {chosen && !open ? (
        // the choice, with a way to search again
        <div className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            {chosen.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: chosen.color }} aria-hidden="true" />}
            <span className="truncate" title={chosen.label}>{chosen.label}</span>
          </span>
          <button type="button" aria-label={t("searchSelect.change", { label })} className="text-muted-foreground hover:text-foreground"
            onClick={() => { onChange(null); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input ref={inputRef} role="combobox" aria-expanded={open} aria-controls={listId} aria-label={label} aria-autocomplete="list"
            aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
            value={query} placeholder={placeholder} onKeyDown={onKey}
            onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm" />
        </div>
      )}
      {open && (
        <ul id={listId} role="listbox" aria-label={label}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {shown.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">{emptyText ?? t("searchSelect.none")}</li>
          ) : shown.map((o, i) => (
            <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={o.id === value}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${i === active ? "bg-accent" : ""}`}>
              {o.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              {o.id === value && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
            </li>
          ))}
          {hits.length > SHOWN && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{t("searchSelect.more", { count: hits.length - SHOWN })}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Groups as options: the path from the top ("Rings › Pilot › Web"), so groups of the same name in
 *  different places can be told apart; sorted by path */
export function groupOptions(groups: Array<{ id: string; name: string; parent_id: string | null; color?: string | null; member_count?: number; is_dynamic?: boolean }>,
                             hint?: (g: { member_count?: number; is_dynamic?: boolean }) => string | undefined): SearchOption[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const path = (g: { id: string; name: string; parent_id: string | null }) => {
    const names = [g.name];
    let p = g.parent_id ? byId.get(g.parent_id) : undefined;
    for (let i = 0; p && i < 20; i++) { names.unshift(p.name); p = p.parent_id ? byId.get(p.parent_id) : undefined; }
    return names.join(" › ");
  };
  return groups.map((g) => ({ id: g.id, label: path(g), color: g.color ?? null, hint: hint?.(g) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
