"use client";

import { useI18n, LANGUAGES } from "@/lib/i18n-context";
import type { ReactNode } from "react";
import { DATE_ORDERS, TIME_FORMATS, formatDateTime, type DateOrder, type TimeFormat } from "@/lib/format";
import { Globe } from "lucide-react";

// A fixed sample date (31 Dec), so day and month can be told apart in the examples.
const SAMPLE = new Date(2026, 11, 31, 14, 30);

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full px-4 py-1.5 text-left text-sm hover:bg-zinc-800 ${selected ? "text-blue-400" : "text-zinc-300"}`}
    >
      {children}
    </button>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{children}</div>;
}

export function LanguageSelector() {
  const { locale, setLocale, timeFormat, setTimeFormat, dateOrder, setDateOrder, t } = useI18n();

  const timeLabel = (format: TimeFormat) =>
    format === "auto" ? t("dateTime.auto") : format === "24h" ? t("dateTime.hours24") : t("dateTime.hours12");
  const dateLabel = (order: DateOrder) =>
    order === "auto" ? t("dateTime.auto") : { dmy: "31.12.2026", mdy: "12/31/2026", ymd: "2026-12-31" }[order];

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-2 px-3 py-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
        title={t("dateTime.menuTitle")}
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline text-sm">{locale.toUpperCase()}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-48 py-1">
        <Heading>{t("dateTime.language")}</Heading>
        {(Object.keys(LANGUAGES) as Array<keyof typeof LANGUAGES>).map((lang) => (
          <Option key={lang} selected={locale === lang} onClick={() => setLocale(lang)}>
            {LANGUAGES[lang]}
          </Option>
        ))}
        <div className="my-1 border-t border-zinc-800" />
        <Heading>{t("dateTime.time")}</Heading>
        {TIME_FORMATS.map((format) => (
          <Option key={format} selected={timeFormat === format} onClick={() => setTimeFormat(format)}>
            {timeLabel(format)}
          </Option>
        ))}
        <div className="my-1 border-t border-zinc-800" />
        <Heading>{t("dateTime.date")}</Heading>
        {DATE_ORDERS.map((order) => (
          <Option key={order} selected={dateOrder === order} onClick={() => setDateOrder(order)}>
            {dateLabel(order)}
          </Option>
        ))}
        <div className="mt-1 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          {t("dateTime.example")}: {formatDateTime(SAMPLE, { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}
