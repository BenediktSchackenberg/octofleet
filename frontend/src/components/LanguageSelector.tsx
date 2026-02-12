"use client";

import { useI18n, LANGUAGES } from "@/lib/i18n-context";
import { Globe } from "lucide-react";

export function LanguageSelector() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-2 px-3 py-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
        title="Language"
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline text-sm">{locale.toUpperCase()}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-32">
        {(Object.keys(LANGUAGES) as Array<keyof typeof LANGUAGES>).map((lang) => (
          <button
            key={lang}
            onClick={() => setLocale(lang)}
            className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 first:rounded-t-lg last:rounded-b-lg ${
              locale === lang ? "text-blue-400" : "text-zinc-300"
            }`}
          >
            {LANGUAGES[lang]}
          </button>
        ))}
      </div>
    </div>
  );
}
