export async function loadProfiles() { return fetch("/api/profiles").then((response) => response.json()); }
export async function createContent(body) { return fetch("/api/generate", { method: "POST", body: JSON.stringify({ body }) }).then((response) => response.json()); }
export async function loadPerformance() { return fetch("/api/performance").then((response) => response.json()); }
