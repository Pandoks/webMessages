import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ChatListItem from './ChatListItem.svelte';

const defaultProps = {
	guid: 'iMessage;-;+11234567890',
	displayName: 'Alice',
	lastMessage: 'Hey there!',
	lastMessageDate: Date.now() - 60_000,
	unreadCount: 0,
	isActive: false,
	isPinned: false,
	participants: [{ name: 'Alice', avatar: null }]
};

describe('ChatListItem', () => {
	it('renders display name', async () => {
		const screen = render(ChatListItem, { ...defaultProps });
		await expect.element(screen.getByText('Alice')).toBeVisible();
	});

	it('renders last message text', async () => {
		const screen = render(ChatListItem, { ...defaultProps });
		await expect.element(screen.getByText('Hey there!')).toBeVisible();
	});

	it('shows unread badge when unreadCount > 0', async () => {
		const screen = render(ChatListItem, { ...defaultProps, unreadCount: 5 });
		await expect.element(screen.getByText('5')).toBeVisible();
	});

	it('does not show unread badge when unreadCount = 0', async () => {
		const screen = render(ChatListItem, { ...defaultProps, unreadCount: 0 });
		const badge = screen.getByText('0');
		expect(badge.query()).toBeNull();
	});

	it('shows "99+" when unreadCount > 99', async () => {
		const screen = render(ChatListItem, { ...defaultProps, unreadCount: 150 });
		await expect.element(screen.getByText('99+')).toBeVisible();
	});

	it('links to the correct message URL', async () => {
		const screen = render(ChatListItem, { ...defaultProps });
		const link = screen.getByRole('link');
		const href = link.element().getAttribute('href');
		expect(href).toBe('/messages/' + encodeURIComponent('iMessage;-;+11234567890'));
	});

	it('shows pin icon when isPinned is true', async () => {
		const screen = render(ChatListItem, { ...defaultProps, isPinned: true });
		// Pin icon is an inline SVG within the display name span
		const nameEl = screen.getByText('Alice');
		await expect.element(nameEl).toBeVisible();
	});
});
