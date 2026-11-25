import { expect, test } from '@playwright/test';

test('home page shows the open draw from the local chain', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Draw #\d+ pool so far/)).toBeVisible();
  await expect(page.getByTestId('pool')).toHaveText(/^\$\d[\d,]*\.\d{2}$/);
  await expect(page.getByTestId('countdown')).toHaveText(/left|Sales closed/);
  await expect(page.getByText(/No contract addresses|isn't on/)).toHaveCount(0);
  // Fits a 360 px screen without sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('a dev wallet connects and shows its test USDC balance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Dev wallet 5 (Anvil)' }).click();
  await expect(page.getByRole('link', { name: 'Wallet' })).toHaveText(/\$[\d,]+\.\d{2}/);
});
