import { test, expect } from '@playwright/test';

test.describe('Messages mode', () => {
	test('root redirects to /messages', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/messages/);
	});

	test('messages page renders with mode toggle', async ({ page }) => {
		await page.goto('/messages');

		// Mode toggle nav should be present with both links
		const nav = page.locator('nav');
		await expect(nav).toBeVisible();

		const messagesLink = nav.getByRole('link', { name: 'Messages' });
		const findMyLink = nav.getByRole('link', { name: 'Find My' });
		await expect(messagesLink).toBeVisible();
		await expect(findMyLink).toBeVisible();
	});

	test('messages page shows empty state placeholder', async ({ page }) => {
		await page.goto('/messages');
		await expect(page.getByText('Select a conversation to start messaging')).toBeVisible();
	});

	test('messages page has correct title', async ({ page }) => {
		await page.goto('/messages');
		await expect(page).toHaveTitle('webMessages');
	});

	test('messages link is active on messages page', async ({ page }) => {
		await page.goto('/messages');
		const nav = page.locator('nav');
		const messagesLink = nav.getByRole('link', { name: 'Messages' });
		const findMyLink = nav.getByRole('link', { name: 'Find My' });
		await expect(messagesLink).toHaveClass(/bg-white/);
		await expect(messagesLink).toHaveClass(/shadow-sm/);
		await expect(findMyLink).not.toHaveClass(/bg-white/);
	});

	test('navigate from messages to find my via mode toggle', async ({ page }) => {
		await page.goto('/messages');

		const nav = page.locator('nav');
		const findMyLink = nav.getByRole('link', { name: 'Find My' });
		await findMyLink.click();

		await expect(page).toHaveURL(/\/findmy/);
	});
});
