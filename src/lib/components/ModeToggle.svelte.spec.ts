import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/messages')
	}
}));

import ModeToggle from './ModeToggle.svelte';

describe('ModeToggle', () => {
	it('renders Messages and Find My links', async () => {
		const screen = render(ModeToggle);
		await expect.element(screen.getByText('Messages')).toBeVisible();
		await expect.element(screen.getByText('Find My')).toBeVisible();
	});

	it('Messages link has correct href', async () => {
		const screen = render(ModeToggle);
		const messagesLink = screen.getByRole('link', { name: 'Messages' });
		await expect.element(messagesLink).toHaveAttribute('href', '/messages');
	});

	it('Find My link has correct href', async () => {
		const screen = render(ModeToggle);
		const findMyLink = screen.getByRole('link', { name: 'Find My' });
		await expect.element(findMyLink).toHaveAttribute('href', '/findmy');
	});

	it('renders a nav element', async () => {
		const screen = render(ModeToggle);
		await expect.element(screen.getByRole('navigation')).toBeVisible();
	});
});
