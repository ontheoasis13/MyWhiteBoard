import { loadPreferences } from "@/features/settings/service";

export function SettingsPage() {
  return <main>Settings {loadPreferences().theme}</main>;
}
