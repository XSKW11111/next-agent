import { expect, test } from "vitest";
import { supportSystemPrompt } from "./system";

test("supportSystemPrompt inlines the skills, the window, and the outage sentence", () => {
  expect(supportSystemPrompt).toContain("That service is temporarily unavailable.");
  expect(supportSystemPrompt).toContain("product-recommend");
  expect(supportSystemPrompt).toContain("early-risers");
  expect(supportSystemPrompt).toContain("handoff");
  expect(supportSystemPrompt).toContain("08:00-10:00");
  expect(supportSystemPrompt).toContain("Confirm");
  expect(supportSystemPrompt).toContain("Cancel");
});
