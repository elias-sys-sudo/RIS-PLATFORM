import { test, expect } from '@playwright/test';

test.describe('Invoices', () => {
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

  test('should display invoice list with data', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: /invoices/i })).toBeVisible();
    // Table should have header columns
    await expect(page.getByRole('columnheader', { name: /invoice #/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /face value/i })).toBeVisible();
  });

  test('should have search and status filter', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    await expect(page.getByRole('combobox', { name: /all statuses/i })).toBeVisible();
  });

  test('should navigate to invoice detail on row click', async ({ page }) => {
    await page.goto('/invoices');
    // Wait for table data
    await page.waitForSelector('td');
    // Click first row
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/\/invoices\/.+/);
  });

  test('should show invoice create wizard for supplier role', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('mms-auth', JSON.stringify({
        state: { user: { id: 'test', email: 'supplier@ris.com', name: 'Test Supplier', role: 'supplier' }, isAuthenticated: true, role: 'supplier' },
        version: 0,
      }));
    });
    await page.goto('/invoices/new');
    await expect(page.getByRole('heading', { name: /new invoice/i })).toBeVisible();
    await expect(page.getByText(/step 1 of 5/i)).toBeVisible();
  });
});
