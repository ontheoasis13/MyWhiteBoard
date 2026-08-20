import { loadSubscription } from "@/features/billing/service";

test("shows the active subscription", () => {
  expect(loadSubscription().status).toBe("active");
});
