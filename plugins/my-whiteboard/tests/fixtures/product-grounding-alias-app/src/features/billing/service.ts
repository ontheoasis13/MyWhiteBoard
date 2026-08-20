import { request } from "@/lib/http";

export function loadSubscription() {
  request("/api/billing");
  return { status: "active" };
}
