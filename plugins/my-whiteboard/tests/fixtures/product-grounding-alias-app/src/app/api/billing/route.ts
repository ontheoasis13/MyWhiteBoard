import { loadSubscription } from "@/features/billing/service";

export async function GET() {
  return Response.json(loadSubscription());
}
