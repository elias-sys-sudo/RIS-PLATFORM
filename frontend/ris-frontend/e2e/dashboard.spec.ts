import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Set auth state before visiting
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('mms-auth', JSON.stringify({
        state: { user: { id: 'test', email: 'admin@ris.com', name: 'Test Admin', role: 'management' }, isAuthenticated: true, role: 'management' },
        version: 0,
      }));
      localStorage.setItem('accessToken', 'fake-token');
    });
    await page.goto('/');
  });

  test('should show management dashboard for management role', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /management dashboard/i })).toBeVisible();
  });

  test('should display KPI stat cards', async ({ page }) => {
    await expect(page.getByText('Total Invoices')).toBeVisible();
    await expect(page.getByText('Total Face Value')).toBeVisible();
    await expect(page.getByText('Collection Rate')).toBeVisible();
  });

  test('should have period selector', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: /30 days/i })).toBeVisible();
  });

  test('should navigate via sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Invoices' }).click();
    await expect(page.getByRole('heading', { name: /invoices/i })).toBeVisible();
  });
});
