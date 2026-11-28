"use client";
import { Palette } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";

/** A few favourite tag colours, one click each */
export const TAG_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#14b8a6", "#64748b"];

/** Tag colour: the favourites as dots, and any other colour through the browser's colour picker */
export function TagColorPicker({ value, onChange }: { value: string | null; onChange: (color: string) => void }) {
  const { t } = useI18n();
  const custom = !!value && !TAG_COLORS.includes(value.toLowerCase());
  const ring = "ring-2 ring-foreground ring-offset-1 ring-offset-background";
  return (
    <span role="radiogroup" aria-label={t("tags.colorLabel")} className="inline-flex items-center gap-1.5">
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value?.toLowerCase() === c} aria-label={c} title={c}
          onClick={() => onChange(c)}
          className={`size-5 rounded-full transition-transform hover:scale-110 ${value?.toLowerCase() === c ? ring : ""}`}
          style={{ backgroundColor: c }} />
      ))}
      {/* any other colour: the native picker behind a dot that shows the chosen one */}
      <label title={t("tags.otherColor")}
        className={`relative inline-flex size-5 cursor-pointer items-center justify-center rounded-full border ${custom ? ring : ""}`}
        style={custom ? { backgroundColor: value! } : undefined}>
        {!custom && <Palette className="size-3 text-muted-foreground" aria-hidden="true" />}
        <input type="color" value={value ?? TAG_COLORS[0]} onChange={(e) => onChange(e.target.value)}
          aria-label={t("tags.otherColor")} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </span>
  );
}
