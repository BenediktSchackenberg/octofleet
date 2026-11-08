import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "src", "app");
const source = readFileSync(join(root, "src", "lib", "routes.ts"), "utf8");
const routeMap = source.match(/const ROUTE_KEYS[^]*?= \{([^]*?)\n\};/)?.[1];
if (!routeMap) throw new Error("ROUTE_KEYS not found");
const entries = [...routeMap.matchAll(/^\s*"(\/[^\"]*)": "([^\"]+)",?$/gm)];
const keys = new Map(entries.map(([, path, key]) => [path, key]));
const errors = [];
if (keys.size !== entries.length) errors.push("Duplicate route in ROUTE_KEYS");

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

for (const page of pages(app)) {
  const relativePath = relative(app, dirname(page)).replaceAll("\\", "/");
  if (relativePath.includes("[")) continue; // dynamic routes have their own label rules
  const route = relativePath === "" ? "/" : `/${relativePath}`;
  if (!keys.has(route)) errors.push(`Missing route label: ${route}`);
}

for (const locale of ["en", "de", "es"]) {
  const translations = JSON.parse(readFileSync(join(root, "src", "locales", `${locale}.json`), "utf8"));
  for (const [route, key] of keys) {
    const value = key.split(".").reduce((node, part) => node?.[part], translations);
    if (typeof value !== "string" || !value) errors.push(`${locale}: ${route} -> ${key} is missing`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Route labels checked: ${keys.size} routes in en/de/es`);
}
