import { loadPreferences } from "@/features/settings/service";

export const accountRouter = router.get("/api/accounts", () => loadPreferences());
