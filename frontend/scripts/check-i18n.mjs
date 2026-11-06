#!/usr/bin/env node
/**
 * Check against new hardcoded UI text (in any language) and fixed "de-DE" dates.
 *
 * Parses every .ts/.tsx file under src/ (locales excluded) with TypeScript and counts the
 * lines that show text without t():
 *   - text between JSX tags, and strings rendered from {…} (also in `a ? "x" : "y"`)
 *   - strings in the attributes placeholder, title, label, description, alt, aria-label
 *   - the first argument of confirm(), alert(), prompt(), toast…() and setError()/setMessage()
 *   - label, title, description, placeholder, message, help properties in object literals
 *   - lines with German words or umlauts in any string, and "de-DE"
 *
 * The counts per file are compared with i18n-baseline.json, which holds the existing
 * backlog. The check fails only if a file has more such lines than its baseline.
 *
 *   npm run check:i18n                    check
 *   node scripts/check-i18n.mjs --list    print every matching line
 *   node scripts/check-i18n.mjs --update  rewrite the baseline (after translating a page)
 *
 * Text that must not be translated (product names, units, code samples) can be marked
 * with an `i18n-ignore` comment on the same line.
 *
 * Text belongs in src/locales/{en,de,es}.json and is shown with t("…"); dates and numbers
 * use the helpers from src/lib/format.ts.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const baselinePath = join(root, "i18n-baseline.json");

// Files that may name a German locale on purpose.
const ALLOWED = new Set(["src/lib/format.ts"]);

const TEXT = /[A-Za-zÄÖÜäöüß]{3,}/;
const TEXT_ATTRIBUTES = new Set(["placeholder", "title", "label", "description", "alt", "aria-label"]);
const TEXT_PROPERTIES = new Set(["label", "title", "description", "placeholder", "message", "help"]);
const MESSAGE_CALLS = /^(confirm|alert|prompt|setError|setMessage|setErrorMessage|setStatusMessage)$/;

const FIXED_LOCALE = /["']de-DE["']/;
const UMLAUT = /[äöüÄÖÜß]/;
const GERMAN_WORDS = new RegExp(
  "\\b(" +
    [
      "Keine", "Kein", "Fehler", "Benutzer", "Einstellungen", "Speichern", "Abbrechen", "Lade",
      "Laden", "Netzwerk", "Sicherheit", "Herausgeber", "Installiert", "verwalten", "abrufen",
      "erstellen", "bearbeiten", "Zeitraum", "Letzte", "Letzter", "Alle", "Neue", "Neuer",
      "Suchen", "Weiter", "Aktualisieren", "Bitte", "nicht", "und", "oder", "wird", "werden",
      "ist", "sind", "Uhr", "Erstelle", "Wechsle", "zwischen", "vorhanden", "konfiguriert",
      "einmalig", "Neuen", "Neu", "Neues", "Gerade", "eben", "vor", "von", "vom", "zum", "zur",
      "auf", "aus", "bei", "nach", "noch", "schon", "jetzt", "der", "das", "dem", "eine", "einen",
      "einer", "einem", "Sekunden", "Minuten", "Stunden", "Tagen", "Woche", "Wochen", "Monate",
      "Datei", "Dateien", "Ordner", "Pfad", "Gruppe", "Gruppen", "Rolle", "Rollen", "Aufgabe",
      "Aufgaben", "Ergebnis", "Ergebnisse", "Starten", "Beenden", "Stoppen", "Entfernen",
      "Anzeigen", "Ausblenden", "Beschreibung", "Erfolgreich", "Gesamt", "Laufend", "Erstes",
      "Paket", "Pakete", "Suche", "Versionen", "Zeige", "Warte", "Zuletzt", "gesehen",
    ].join("|") +
    ")\\b",
  "i",
);
const GERMAN_ENDINGS = /\b[A-Za-zÄÖÜäöüß]{3,}(ungen|ung|keit|heit|ionen|fenster|bild|pfade|lich|isch)\b/i;

function germanOrFixedLocale(text) {
  return FIXED_LOCALE.test(text) || UMLAUT.test(text) || GERMAN_WORDS.test(text) || GERMAN_ENDINGS.test(text);
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

function stringText(node) {
  if (ts.isTemplateExpression(node)) {
    return node.head.text + " " + node.templateSpans.map((span) => span.literal.text).join(" ");
  }
  return node.text;
}

/** Strings an expression can evaluate to directly (through ?:, ||, ??, &&, + and parentheses). */
function renderedStrings(expr, out = []) {
  if (!expr) return out;
  if (isStringLike(expr)) out.push(expr);
  else if (ts.isParenthesizedExpression(expr)) renderedStrings(expr.expression, out);
  else if (ts.isConditionalExpression(expr)) {
    renderedStrings(expr.whenTrue, out);
    renderedStrings(expr.whenFalse, out);
  } else if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) {
      renderedStrings(expr.left, out);
      renderedStrings(expr.right, out);
    } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      renderedStrings(expr.right, out);
    }
  }
  return out;
}

function calleeName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) {
    // toast("…"), toast.error("…"), window.confirm("…")
    if (ts.isIdentifier(callee.expression) && callee.expression.text === "toast") return "toast";
    return callee.name.text;
  }
  return "";
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return "";
}

/** Lines (1-based) with hardcoded UI text in one file. */
function scan(file, source) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const sourceLines = source.split("\n");
  const hits = new Set();
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const addText = (node, text) => {
    if (TEXT.test(text)) hits.add(lineOf(node));
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      // one JSX text can span several lines: report each line that has words
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      node.getText(sf).split("\n").forEach((part, i) => {
        if (TEXT.test(part)) hits.add(start + i + 1);
      });
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const s of renderedStrings(node.expression)) addText(s, stringText(s));
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      const strings = ts.isStringLiteral(init) ? [init] : ts.isJsxExpression(init) ? renderedStrings(init.expression) : [];
      for (const s of strings) addText(s, stringText(s));
    } else if (ts.isCallExpression(node) && node.arguments.length) {
      const name = calleeName(node);
      if (name === "toast" || MESSAGE_CALLS.test(name)) {
        for (const s of renderedStrings(node.arguments[0])) addText(s, stringText(s));
      }
    } else if (ts.isPropertyAssignment(node) && TEXT_PROPERTIES.has(propertyName(node.name))) {
      for (const s of renderedStrings(node.initializer)) addText(s, stringText(s));
    }
    if (isStringLike(node) && germanOrFixedLocale(stringText(node))) hits.add(lineOf(node));
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return [...hits]
    .filter((n) => !sourceLines[n - 1].includes("i18n-ignore"))
    .sort((a, b) => a - b)
    .map((number) => ({ number, text: sourceLines[number - 1] }));
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "locales" || name === "node_modules") continue;
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      yield path;
    }
  }
}

const found = {};
const lines = {};
for (const path of sourceFiles(srcDir)) {
  const file = relative(root, path).split(sep).join("/");
  if (ALLOWED.has(file)) continue;
  const hits = scan(file, readFileSync(path, "utf8"));
  if (hits.length) {
    found[file] = hits.length;
    lines[file] = hits;
  }
}

const total = Object.values(found).reduce((a, b) => a + b, 0);

if (process.argv.includes("--list")) {
  for (const [file, hits] of Object.entries(lines)) {
    for (const { text, number } of hits) console.log(`${file}:${number}: ${text.trim().slice(0, 140)}`);
  }
  process.exit(0);
}

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`i18n baseline updated: ${total} lines in ${Object.keys(found).length} files.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
let failed = false;
for (const [file, count] of Object.entries(found)) {
  const allowed = baseline[file] ?? 0;
  if (count > allowed) {
    failed = true;
    console.error(`\n${file}: ${count} lines with hardcoded text (baseline ${allowed}):`);
    for (const { text, number } of lines[file]) console.error(`  ${number}: ${text.trim().slice(0, 140)}`);
  }
}
const lowered = Object.entries(baseline).filter(([file, allowed]) => (found[file] ?? 0) < allowed);

if (failed) {
  console.error(
    "\nMove the text to src/locales/{en,de,es}.json and use t(\"…\"); format dates with src/lib/format.ts. " +
      "Mark text that must not be translated with an i18n-ignore comment. " +
      "The lines listed include the existing backlog of the file.",
  );
  process.exit(1);
}
console.log(`i18n check passed (${total} lines of existing backlog).`);
if (lowered.length) {
  console.log(`${lowered.length} file(s) have fewer lines than their baseline – run with --update to lower it.`);
}
