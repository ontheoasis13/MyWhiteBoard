import { BillingPage } from "@/app/billing/page";
import { SettingsPage } from "@/app/settings/page";

export function App() {
  return <><Route path="/project" element={<BillingPage />} /><BillingPage /><SettingsPage /></>;
}
