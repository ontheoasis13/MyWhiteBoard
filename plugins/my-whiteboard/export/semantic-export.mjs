import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { workspacePaths } from "../core/store.mjs";

const require = createRequire(import.meta.url);

function escapeXml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

function styleFor(element) {
  const style = element.properties?.style || {};
  return {
    fill: style.backgroundColor || style.fill || (element.kind === "note" ? "#fff7cc" : "#ffffff"),
    stroke: style.strokeColor || style.stroke || "#475569",
    strokeWidth: Number(style.strokeWidth || 2),
    color: style.color || "#172033",
  };
}

function layoutFor(element) {
  return {
    x: Number(element.layout?.x || 0),
    y: Number(element.layout?.y || 0),
    width: Math.max(1, Number(element.layout?.width || 180)),
    height: Math.max(1, Number(element.layout?.height || 100)),
  };
}

function center(element) {
  const layout = layoutFor(element);
  return { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 };
}

export function semanticBoardToSvg(board) {
  const elements = Object.values(board?.elements || {});
  const nodes = elements.filter((element) => element.kind !== "edge");
  const edges = elements.filter((element) => element.kind === "edge");
  const byId = new Map(nodes.map((element) => [element.id, element]));
  const bounds = nodes.length ? nodes.reduce((current, element) => {
    const layout = layoutFor(element);
    return { minX: Math.min(current.minX, layout.x), minY: Math.min(current.minY, layout.y), maxX: Math.max(current.maxX, layout.x + layout.width), maxY: Math.max(current.maxY, layout.y + layout.height) };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) : { minX: 0, minY: 0, maxX: 1280, maxY: 800 };
  const padding = 80;
  const width = Math.max(320, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(240, bounds.maxY - bounds.minY + padding * 2);
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;
  const output = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<rect width="100%" height="100%" fill="#f8fafc"/>`, `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>`];
  for (const edge of edges) {
    const source = byId.get(edge.properties?.sourceId);
    const target = byId.get(edge.properties?.targetId);
    if (!source || !target) continue;
    const a = center(source); const b = center(target);
    output.push(`<line x1="${a.x + offsetX}" y1="${a.y + offsetY}" x2="${b.x + offsetX}" y2="${b.y + offsetY}" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>`);
    if (edge.label) output.push(`<text x="${(a.x + b.x) / 2 + offsetX}" y="${(a.y + b.y) / 2 + offsetY - 8}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="13" fill="#475569">${escapeXml(edge.label)}</text>`);
  }
  for (const element of nodes) {
    const layout = layoutFor(element); const style = styleFor(element); const x = layout.x + offsetX; const y = layout.y + offsetY;
    if (element.semanticType === "database") output.push(`<ellipse cx="${x + layout.width / 2}" cy="${y + layout.height / 2}" rx="${layout.width / 2}" ry="${layout.height / 2}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`);
    else if (element.semanticType === "decision") output.push(`<polygon points="${x + layout.width / 2},${y} ${x + layout.width},${y + layout.height / 2} ${x + layout.width / 2},${y + layout.height} ${x},${y + layout.height / 2}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`);
    else output.push(`<rect x="${x}" y="${y}" width="${layout.width}" height="${layout.height}" rx="12" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`);
    if (element.label) output.push(`<text x="${x + layout.width / 2}" y="${y + layout.height / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Inter,Arial,sans-serif" font-size="16" fill="${style.color}">${escapeXml(element.label)}</text>`);
  }
  output.push("</svg>");
  return output.join("");
}

function loadSharp() {
  try { return require("sharp"); } catch {}
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "sharp");
  try { return require(bundled); } catch {}
  throw new Error("PNG export requires Sharp. JSON and SVG export remain available.");
}

export async function exportSemanticBoard(projectRoot, board, format) {
  const exportsDirectory = path.join(workspacePaths(projectRoot).directory, "exports");
  await mkdir(exportsDirectory, { recursive: true });
  let output;
  if (format === "json") {
    output = path.join(exportsDirectory, `${board.id}.semantic.json`);
    await writeFile(output, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  } else {
    const svg = semanticBoardToSvg(board);
    const svgPath = path.join(exportsDirectory, `${board.id}.svg`);
    await writeFile(svgPath, svg, "utf8");
    output = svgPath;
    if (format === "png") {
      output = path.join(exportsDirectory, `${board.id}.png`);
      await loadSharp()(Buffer.from(svg)).png().toFile(output);
    }
  }
  return { path: output, format, sha256: createHash("sha256").update(await readFile(output)).digest("hex") };
}
