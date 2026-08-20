import { loadSubscription } from "@/features/billing/service";

export function BillingPage() {
  return <main>Billing {loadSubscription().status}</main>;
}
