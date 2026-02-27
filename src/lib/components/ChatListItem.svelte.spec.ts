import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import ChatListItem from './ChatListItem.svelte';

const defaultProps = {
	guid: 'iMessage;-;+11234567890',
	displayName: 'Alice',
	lastMessage: 'Hey there!',
	lastMessageDate: Date.now() - 60_000,
	unreadCount: 0,
	isActive: false,
	isPinned: false,
	onTogglePin: vi.fn()
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

	it('calls onTogglePin when pin button clicked', async () => {
		const onTogglePin = vi.fn();
		const screen = render(ChatListItem, { ...defaultProps, onTogglePin });
		const pinButton = screen.getByRole('button', { name: /pin conversation/i });
		await pinButton.click();
		expect(onTogglePin).toHaveBeenCalledWith('iMessage;-;+11234567890');
	});

	it('links to the correct message URL', async () => {
		const screen = render(ChatListItem, { ...defaultProps });
		const link = screen.getByRole('link');
		const href = link.element().getAttribute('href');
		expect(href).toBe('/messages/' + encodeURIComponent('iMessage;-;+11234567890'));
	});

	it('shows pin icon when isPinned is true', async () => {
		const screen = render(ChatListItem, { ...defaultProps, isPinned: true });
		const unpinButton = screen.getByRole('button', { name: 'Unpin conversation' });
		await expect.element(unpinButton).toBeVisible();
	});
});
