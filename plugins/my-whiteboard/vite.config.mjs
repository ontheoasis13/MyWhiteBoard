import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "apps", "workspace"),
  base: "/workspace/",
  plugins: [react()],
  define: {
    "process.env.IS_PREACT": JSON.stringify("true"),
  },
  build: {
    target: "es2022",
    outDir: path.join(root, "assets", "workspace"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
