import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const destination = path.join(root, "assets", "workspace", "fonts");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
