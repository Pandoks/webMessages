import { test, expect } from '@playwright/test';

test.describe('Find My mode', () => {
	test('find my page loads', async ({ page }) => {
		await page.goto('/findmy');
		await expect(page).toHaveURL(/\/findmy/);
		await expect(page.locator('nav')).toBeVisible();
	});

	test('find my page has mode toggle', async ({ page }) => {
		await page.goto('/findmy');

		const nav = page.locator('nav');
		await expect(nav).toBeVisible();

		const messagesLink = nav.getByRole('link', { name: 'Messages' });
		const findMyLink = nav.getByRole('link', { name: 'Find My' });
		await expect(messagesLink).toBeVisible();
		await expect(findMyLink).toBeVisible();
	});

	test('find my link is active on find my page', async ({ page }) => {
		await page.goto('/findmy');
		const nav = page.locator('nav');
		const findMyLink = nav.getByRole('link', { name: 'Find My' });
		const messagesLink = nav.getByRole('link', { name: 'Messages' });
		await expect(findMyLink).toHaveClass(/bg-white/);
		await expect(findMyLink).toHaveClass(/shadow-sm/);
		await expect(messagesLink).not.toHaveClass(/bg-white/);
	});

	test('find my page has correct title', async ({ page }) => {
		await page.goto('/findmy');
		await expect(page).toHaveTitle('webMessages');
	});

	test('navigate from find my to messages via mode toggle', async ({ page }) => {
		await page.goto('/findmy');

		const nav = page.locator('nav');
		const messagesLink = nav.getByRole('link', { name: 'Messages' });
		await messagesLink.click();

		await expect(page).toHaveURL(/\/messages/);
	});

	test('find my page renders main content area', async ({ page }) => {
		await page.goto('/findmy');
		const mainContent = page.locator('main');
		await expect(mainContent).toBeVisible();
		// Verify it has some child content
		await expect(mainContent.locator('> *').first()).toBeVisible();
	});
});
