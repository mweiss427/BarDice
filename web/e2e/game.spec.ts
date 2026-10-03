import { expect, test, type Page } from "@playwright/test";

const RPC = "http://127.0.0.1:8545";

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

/** Set E2E_SCREENSHOT_DIR to save screenshots of key moments (handy for PRs and docs). */
async function snap(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function dice(page: Page) {
  return page.locator('[data-testid^="die-"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))));
}

test("a full night at the bar: shake, farm, roll, stand, settle, claim", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const response = await page.goto("/");
  // Clickjacking protection has to be a real header.
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: /Bar Dice/ })).toBeVisible();

  // The production build ships a strict Content-Security-Policy.
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByTestId("account")).toHaveText(/0x7099…79C8/);

  // Shake: pays 0.1 ETH and waits for (mock) Chainlink VRF.
  await page.getByRole("button", { name: /Shake the cup \(0\.1 ETH\)/ }).click();
  await expect(page.getByTestId("turn-status")).toContainText("Roll 1 of 3", { timeout: 30_000 });
  const first = await dice(page);
  expect(first.every((d) => d >= 1 && d <= 6)).toBe(true);

  // Farm the first die and roll the other four.
  await page.getByTestId("die-0").click();
  await page.getByRole("button", { name: "Roll 4 dice" }).click();
  await expect(page.getByTestId("turn-status")).toContainText("Roll 2 of 3", { timeout: 30_000 });
  const second = await dice(page);
  expect(second[0]).toBe(first[0]); // farmed die never changes — and the UI shows fresh dice without a reload

  await snap(page, "1-after-second-roll");

  // Farmed dice can't be un-farmed.
  await expect(page.getByTestId("die-0")).toBeDisabled();

  await page.getByRole("button", { name: /Stand/ }).click();
  await expect(page.getByTestId("turn-status")).toContainText("Final score", { timeout: 30_000 });
  await expect(page.getByTestId("top-score")).not.toHaveText("No scores yet");

  // Can't shake twice in one day.
  await expect(page.getByRole("button", { name: /Shake the cup/ })).toHaveCount(0);

  // Close the bar: jump past settlement time, then settle + claim from the UI.
  await rpc("evm_increaseTime", [2 * 86_400]);
  await rpc("evm_mine");
  const claim = page.getByRole("button", { name: /Settle & claim/ });
  await expect(claim).toBeVisible({ timeout: 30_000 });
  await claim.click();
  await expect(page.getByText(/Won 0\.0475 ETH ✓/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/0\.0025 ETH to charity/)).toBeVisible();
  await snap(page, "2-claimed");

  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
