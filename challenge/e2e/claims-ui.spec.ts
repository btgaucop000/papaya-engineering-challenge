import { expect, test } from "@playwright/test";

import { blockedClaimId, successClaimId } from "./global-setup";

test("shows a blocked transition, completes a valid transition, and refreshes audit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await expect(page.getByLabel("Working as")).toHaveValue("demo-document-clerk");
  await expect(page.getByText("document_clerk", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`Claim ${blockedClaimId.slice(0, 8)}`, "i") }).click();
  const blockedTransition = page.getByTestId("transition-verify_documents");
  await expect(blockedTransition.getByText("Prerequisites needed")).toBeVisible();
  await expect(
    blockedTransition.getByText("All required documents must be present and valid"),
  ).toBeVisible();
  await expect(blockedTransition.getByRole("button", { name: "Run · Verify Documents" })).toBeDisabled();

  await page.getByRole("button", { name: new RegExp(`Claim ${successClaimId.slice(0, 8)}`, "i") }).click();
  await page.getByLabel("Present").check();
  await page.getByLabel("Valid").check();
  await page.getByRole("button", { name: "Save document status" }).click();
  await expect(page.getByTestId("success-notice")).toContainText("Document status saved");

  const readyTransition = page.getByTestId("transition-verify_documents");
  await expect(readyTransition.getByText("Ready", { exact: true })).toBeVisible();
  await readyTransition.getByLabel("Transition notes").fill("Verified in browser flow");
  await readyTransition.getByRole("button", { name: "Run · Verify Documents" }).click();

  await expect(page.getByTestId("success-notice")).toContainText("Verify Documents completed");
  await expect(page.getByRole("heading", { name: "Documents Verified", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verify Documents" }).last()).toBeVisible();
  await expect(page.getByText("demo-document-clerk")).toBeVisible();
  await expect(page.getByText("Verified in browser flow")).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "challenge/evidence/claims-ui-desktop.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Working as")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit timeline" })).toBeVisible();
  await page.screenshot({
    path: "challenge/evidence/claims-ui-mobile.png",
    fullPage: true,
  });
});
