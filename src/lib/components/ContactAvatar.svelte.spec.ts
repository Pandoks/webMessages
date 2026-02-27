import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContactAvatar from './ContactAvatar.svelte';

describe('ContactAvatar', () => {
	it('shows initials when no avatar provided', async () => {
		const screen = render(ContactAvatar, { name: 'Alice' });
		await expect.element(screen.getByText('A')).toBeVisible();
	});

	it('shows correct initials for multi-word name', async () => {
		const screen = render(ContactAvatar, { name: 'John Doe' });
		await expect.element(screen.getByText('JD')).toBeVisible();
	});

	it('shows "?" for empty name', async () => {
		const screen = render(ContactAvatar, { name: '' });
		await expect.element(screen.getByText('?')).toBeVisible();
	});

	it('shows img element when avatar URL provided', async () => {
		const screen = render(ContactAvatar, {
			name: 'Alice',
			avatar: 'https://example.com/photo.jpg'
		});
		await expect.element(screen.getByAltText('Alice')).toBeVisible();
		expect(screen.getByAltText('Alice').element().tagName).toBe('IMG');
	});

	it('applies sm size classes', async () => {
		const screen = render(ContactAvatar, { name: 'Alice', size: 'sm' });
		const el = screen.getByText('A').element();
		expect(el.className).toContain('h-8');
		expect(el.className).toContain('w-8');
		expect(el.className).toContain('text-xs');
	});

	it('applies md size classes by default', async () => {
		const screen = render(ContactAvatar, { name: 'Alice' });
		const el = screen.getByText('A').element();
		expect(el.className).toContain('h-10');
		expect(el.className).toContain('w-10');
		expect(el.className).toContain('text-sm');
	});

	it('applies lg size classes', async () => {
		const screen = render(ContactAvatar, { name: 'Alice', size: 'lg' });
		const el = screen.getByText('A').element();
		expect(el.className).toContain('h-12');
		expect(el.className).toContain('w-12');
		expect(el.className).toContain('text-base');
	});

	it('handles comma-separated names', async () => {
		const screen = render(ContactAvatar, { name: 'Doe, Jane' });
		await expect.element(screen.getByText('DJ')).toBeVisible();
	});
});
