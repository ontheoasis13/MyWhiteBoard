import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
export const OBSERVATION_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ".html", ".css", ".prisma", ".sql"]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".codex",
  ".my-whiteboard",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".venv",
  "assets",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "generated",
  "node_modules",
  "out",
  "storybook-static",
  "vendor",
  "venv",
]);

const GENERATED_FILE_PATTERNS = [/\.min\.(?:js|css)$/i, /(?:^|[-_.])(bundle|chunk|generated|compiled)(?:[-_.]|$)/i];
const BINARY_EXTENSIONS = new Set([".sqlite", ".sqlite3", ".db", ".db3", ".woff", ".woff2", ".ttf", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"]);

export function classifySourceFile(relative, source = "") {
  const normalized = String(relative || "").replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const extension = path.extname(lower);
  if (BINARY_EXTENSIONS.has(extension)) return "binary_dependency";
  if (/(^|\/)(vendor|node_modules)(\/|$)/.test(lower)) return "vendor";
  if (/(^|\/)(generated|dist|build|out|coverage)(\/|$)/.test(lower) || GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(lower))) return "generated";
  if (/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return "test";
  if (extension === ".html") return "ui_entry";
  if (extension === ".css") return "supporting_asset";
  if (SOURCE_EXTENSIONS.has(extension)) return "application_source";
  return source ? "application_source" : "binary_dependency";
}

const RESOLUTION_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];

function posix(value) {
  return value.replaceAll(path.sep, "/");
}

function withoutJsonComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}

async function readConfig(projectRoot) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const parsed = JSON.parse(withoutJsonComments(await readFile(path.join(projectRoot, name), "utf8")));
      return { name, compilerOptions: parsed.compilerOptions || {} };
    } catch {}
  }
  return { name: null, compilerOptions: {} };
}

function aliasRules(config) {
  const baseUrl = posix(String(config.compilerOptions.baseUrl || ".")).replace(/^\.\//, "");
  const paths = config.compilerOptions.paths || {};
  return Object.entries(paths).flatMap(([pattern, targets]) => (Array.isArray(targets) ? targets : []).map((target) => ({
    pattern,
    target: posix(path.posix.join(baseUrl || ".", String(target))),
  })));
}

function matchAlias(specifier, rule) {
  const star = rule.pattern.indexOf("*");
  if (star < 0) return specifier === rule.pattern ? rule.target : null;
  const prefix = rule.pattern.slice(0, star);
  const suffix = rule.pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length || undefined);
  return rule.target.replace("*", wildcard);
}

function resolutionCandidates(base) {
  const normalized = path.posix.normalize(base).replace(/^\.\//, "");
  const extension = path.posix.extname(normalized);
  const candidates = [normalized];
  if (!extension) {
    for (const item of RESOLUTION_EXTENSIONS) candidates.push(`${normalized}${item}`);
    for (const item of RESOLUTION_EXTENSIONS) candidates.push(`${normalized}/index${item}`);
  } else if ([".js", ".mjs", ".cjs"].includes(extension)) {
    const stem = normalized.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.jsx`);
  }
  return [...new Set(candidates)];
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function extractImportSpecifiers(source) {
  const results = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      results.push({ specifier: match[1], line: lineAt(source, match.index || 0) });
    }
  }
  return [...new Map(results.map((item) => [`${item.line}:${item.specifier}`, item])).values()]
    .sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

export function resolveImportTarget(sourceFile, specifier, fileSet, aliases = []) {
  const bases = [];
  if (specifier.startsWith(".")) {
    bases.push(path.posix.join(path.posix.dirname(sourceFile), specifier));
  } else {
    for (const rule of aliases) {
      const matched = matchAlias(specifier, rule);
      if (matched) bases.push(matched);
    }
  }
  for (const base of bases) {
    for (const candidate of resolutionCandidates(base)) {
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

export async function collectProjectFiles(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const extensions = options.extensions || SOURCE_EXTENSIONS;
  const maxFiles = Math.max(1, Math.min(2_000, Number(options.maxFiles || 300)));
  const maxBytes = Math.max(1_024, Number(options.maxBytes || 512_000));
  const discovered = [];

  async function visit(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      if (GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
      try {
        if ((await stat(absolute)).size <= maxBytes) discovered.push(absolute);
      } catch {}
    }
  }

  await visit(root);
  return discovered
    .map((absolute) => ({ absolute, relative: posix(path.relative(root, absolute)) }))
    .sort((a, b) => a.relative.localeCompare(b.relative))
    .slice(0, maxFiles);
}

export async function scanProjectSources(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const config = await readConfig(root);
  const aliases = aliasRules(config);
  const inventory = await collectProjectFiles(root, options);
  const fileSet = new Set(inventory.map((item) => item.relative));
  const files = [];
  for (const item of inventory) {
    let source = "";
    try {
      source = await readFile(item.absolute, "utf8");
    } catch {}
    const imports = extractImportSpecifiers(source).map((entry) => ({
      ...entry,
      target: resolveImportTarget(item.relative, entry.specifier, fileSet, aliases),
    }));
    files.push({
      ...item,
      source,
      sourceHash: createHash("sha256").update(source).digest("hex"),
      classification: classifySourceFile(item.relative, source),
      imports,
    });
  }
  return {
    root,
    config: config.name,
    aliases,
    files,
  };
}
