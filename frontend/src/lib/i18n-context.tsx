"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import de from "@/locales/de.json";
import en from "@/locales/en.json";

type Locale = "de" | "en";
type Translations = typeof de;

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const translations: Record<Locale, Translations> = { de, en };

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("de");

  useEffect(() => {
    // Load saved locale from localStorage
    const saved = localStorage.getItem("locale") as Locale;
    if (saved && translations[saved]) {
      setLocaleState(saved);
    } else {
      // Auto-detect from browser
      const browserLang = navigator.language.split("-")[0];
      if (browserLang === "de" || browserLang === "en") {
        setLocaleState(browserLang as Locale);
      }
    }
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let text = getNestedValue(translations[locale], key);
      
      // Fallback to English if not found
      if (!text && locale !== "en") {
        text = getNestedValue(translations.en, key);
      }
      
      // Return key if not found
      if (!text) return key;

      // Replace params like {name} with values
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text!.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        });
      }

      return text;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

// Language names for display
export const LANGUAGES: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
};
