#!/usr/bin/env node
/**
 * Lightweight check against new hardcoded German UI text and fixed "de-DE" dates.
 *
 * Counts suspicious lines (umlauts, common German words and word endings, "de-DE") per
 * file under src/ (locales excluded) and compares them with i18n-baseline.json, which holds
 * the existing backlog. The check fails only if a file has more such lines than its
 * baseline. After translating a page, lower the baseline:
 *
 *   node scripts/check-i18n.mjs --update
 *
 * `--list` prints every matching line (e.g. to see what is left on a page).
 *
 * Text belongs in src/locales/{en,de,es}.json and is shown with t("…"); dates and numbers
 * use localeTag() or the helpers from src/lib/format.ts.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const baselinePath = join(root, "i18n-baseline.json");

// Files that may name a German locale on purpose.
const ALLOWED = new Set(["src/lib/format.ts"]);

const FIXED_LOCALE = /["']de-DE["']/;
const UMLAUT = /[äöüÄÖÜß]/;
const GERMAN_WORDS = new RegExp(
  "\\b(" +
    [
      "Keine", "Kein", "Fehler", "Benutzer", "Einstellungen", "Speichern", "Abbrechen",
      "Lade", "Laden", "Netzwerk", "Sicherheit", "Herausgeber", "Installiert", "verwalten",
      "abrufen", "erstellen", "bearbeiten", "Zeitraum", "Letzte", "Letzter", "Alle", "Neue",
      "Neuer", "Suchen", "Weiter", "Aktualisieren", "Bitte", "nicht", "und", "oder", "wird",
      "werden", "ist", "sind", "Uhr",
      // more common words in the UI texts
      "Erstelle", "Erstellen", "Wechsle", "zwischen", "vorhanden", "konfiguriert", "einmalig",
      "Neuen", "Neu", "Gerade", "eben", "vor", "von", "vom", "zum", "zur", "auf", "aus", "bei",
      "nach", "noch", "schon", "jetzt", "der", "das", "dem", "eine", "einen", "einer", "einem",
      "Sekunden", "Minuten", "Stunden", "Tagen", "Woche", "Wochen", "Monate", "Datei", "Dateien",
      "Ordner", "Pfad", "Gerät", "Gruppe", "Gruppen", "Rolle", "Rollen", "Aufgabe", "Aufgaben",
      "Ergebnis", "Ergebnisse", "Ausführen", "Starten", "Beenden", "Stoppen", "Entfernen",
      "Anzeigen", "Ausblenden", "Beschreibung", "Verwendungen", "Erfolgreich", "Gesamt", "Laufend",
      "Neues", "Erstes", "Ersten", "Paket", "Pakete", "Pakets", "Suche", "Versionen", "Zeige", "Warte",
    ].join("|") +
    ")\\b",
  "i", // also lower case, e.g. "Pakete suchen"
);
// Typical German word endings ("Erscheinungsbild", "Wartungsfenster", "Integrationen" …).
const GERMAN_ENDINGS = /\b[A-Za-zÄÖÜäöüß]{3,}(ungen|ung|keit|heit|ionen|fenster|bild|pfade|lich|isch)\b/i;

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("{/*");
}

function suspicious(line) {
  if (isComment(line)) return false;
  return FIXED_LOCALE.test(line) || UMLAUT.test(line) || GERMAN_WORDS.test(line) || GERMAN_ENDINGS.test(line);
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "locales" || name === "node_modules") continue;
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield path;
    }
  }
}

const found = {};
const lines = {};
for (const path of sourceFiles(srcDir)) {
  const file = relative(root, path).split(sep).join("/");
  if (ALLOWED.has(file)) continue;
  const hits = readFileSync(path, "utf8")
    .split("\n")
    .map((text, i) => ({ text, number: i + 1 }))
    .filter(({ text }) => suspicious(text));
  if (hits.length) {
    found[file] = hits.length;
    lines[file] = hits;
  }
}

if (process.argv.includes("--list")) {
  for (const [file, hits] of Object.entries(lines)) {
    for (const { text, number } of hits) console.log(`${file}:${number}: ${text.trim().slice(0, 140)}`);
  }
  process.exit(0);
}

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + "\n");
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  console.log(`i18n baseline updated: ${total} lines in ${Object.keys(found).length} files.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
let failed = false;
for (const [file, count] of Object.entries(found)) {
  const allowed = baseline[file] ?? 0;
  if (count > allowed) {
    failed = true;
    console.error(`\n${file}: ${count} lines with hardcoded German text or "de-DE" (baseline ${allowed}):`);
    for (const { text, number } of lines[file]) console.error(`  ${number}: ${text.trim().slice(0, 140)}`);
  }
}
const lowered = Object.entries(baseline).filter(([file, allowed]) => (found[file] ?? 0) < allowed);

if (failed) {
  console.error(
    "\nMove the text to src/locales/{en,de,es}.json and use t(\"…\"); format dates with localeTag() " +
      "or src/lib/format.ts. The lines listed include the existing backlog of the file.",
  );
  process.exit(1);
}
console.log("i18n check passed.");
if (lowered.length) {
  console.log(`${lowered.length} file(s) have fewer lines than their baseline – run with --update to lower it.`);
}
