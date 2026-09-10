import { expect, test } from '@playwright/test';

test('app loads and shows the education-only disclaimer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'VentSim' })).toBeVisible();
  await expect(page.getByTestId('disclaimer')).toContainText('education only');
});
