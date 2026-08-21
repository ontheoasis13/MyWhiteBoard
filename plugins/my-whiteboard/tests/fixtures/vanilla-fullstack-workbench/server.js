import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("./data/workbench.sqlite");
database.exec("CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY, body TEXT)");

export function profiles() { return [{ id: 1, name: "Demo profile" }]; }
export function generate(body) { return { content: `Generated: ${body || ""}` }; }
export function content() { return []; }
export function performance() { return { score: 98 }; }

export const server = createServer((request, response) => {
  if (request.url === "/api/profiles") return response.end(JSON.stringify(profiles()));
  if (request.url === "/api/generate" && request.method === "POST") return response.end(JSON.stringify(generate("demo")));
  if (request.url === "/api/content") return response.end(JSON.stringify(content()));
  if (request.url === "/api/performance") return response.end(JSON.stringify(performance()));
  response.statusCode = 404; response.end("not found");
});

if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(0);
