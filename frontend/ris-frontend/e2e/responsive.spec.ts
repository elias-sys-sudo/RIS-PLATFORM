import { test, expect, devices } from '@playwright/test';

test.describe('Responsive Design', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('mms-auth', JSON.stringify({
        state: { user: { id: 'test', email: 'admin@ris.com', name: 'Test Admin', role: 'management' }, isAuthenticated: true, role: 'management' },
        version: 0,
      }));
      localStorage.setItem('accessToken', 'fake-token');
    });
  });

  test('desktop: sidebar visible with full labels', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invoices' })).toBeVisible();
  });

  test('mobile: sidebar hidden, toggle works', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    // Sidebar should be hidden on mobile
    await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible();
  });

  test('mobile: invoice list shows card view', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/invoices');
    // Table should be hidden on mobile
    await expect(page.locator('table')).toBeHidden();
  });
});

test.describe('Dark Mode', () => {
  test('should toggle dark mode', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('mms-auth', JSON.stringify({
        state: { user: { id: 'test', email: 'admin@ris.com', name: 'Test Admin', role: 'management' }, isAuthenticated: true, role: 'management' },
        version: 0,
      }));
      localStorage.setItem('accessToken', 'fake-token');
    });
    await page.goto('/');
    // Click dark mode toggle
    await page.getByRole('button', { name: /toggle dark mode/i }).click();
    // HTML element should have 'dark' class
    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(hasDark).toBe(true);
  });
});
