import { request } from "@/lib/http";

export function loadPreferences() {
  request("/api/settings");
  return { theme: "system" };
}
