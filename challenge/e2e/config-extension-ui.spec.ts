import { expect, test } from "@playwright/test";

import { extensionClaimId } from "./config-extension-global-setup";

test("renders and executes config-only manual-review transitions", async ({ page, request }) => {
  const initialMetadata = await request.get(
    `http://127.0.0.1:3100/api/claims/${extensionClaimId}/transitions`,
    { headers: { "x-demo-user-id": "demo-team-lead" } },
  );
  expect(initialMetadata.ok()).toBeTruthy();
  await expect(initialMetadata.json()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        transitionId: "send_to_manual_review",
        transitionLabel: "Send to Manual Review",
        fromState: "UNDER_ASSESSMENT",
        toState: "MANUAL_REVIEW",
        toStateLabel: "Manual Review",
        requiredRoles: ["team_lead"],
        authorized: true,
        available: true,
      }),
    ]),
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByLabel("Working as").selectOption("demo-team-lead");

  const enterReview = page.getByTestId("transition-send_to_manual_review");
  await expect(enterReview.getByText("Ready", { exact: true })).toBeVisible();
  await enterReview.getByLabel("Transition notes").fill("Config-only extension demo");
  await enterReview.getByRole("button", { name: /Send to Manual Review/ }).click();

  await expect(page.getByRole("heading", { name: "Manual Review", exact: true })).toBeVisible();
  const returnToAssessment = page.getByTestId("transition-return_to_assessment");
  await expect(returnToAssessment.getByText("Ready", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "challenge/evidence/config-extension-manual-review.png",
    fullPage: true,
  });

  const manualReviewMetadata = await request.get(
    `http://127.0.0.1:3100/api/claims/${extensionClaimId}/transitions`,
    { headers: { "x-demo-user-id": "demo-team-lead" } },
  );
  expect(manualReviewMetadata.ok()).toBeTruthy();
  await expect(manualReviewMetadata.json()).resolves.toEqual([
    expect.objectContaining({
      transitionId: "return_to_assessment",
      fromStateLabel: "Manual Review",
      toStateLabel: "Under Assessment",
      available: true,
    }),
  ]);

  await returnToAssessment.getByLabel("Transition notes").fill("Manual review complete");
  await returnToAssessment.getByRole("button", { name: /Return to Assessment/ }).click();
  await expect(page.getByRole("heading", { name: "Under Assessment", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send to Manual Review" }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Return to Assessment" }).last()).toBeVisible();

  await page.screenshot({
    path: "challenge/evidence/config-extension-ui.png",
    fullPage: true,
  });
});
