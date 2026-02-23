import type { Message } from '$lib/types/index.js';

type NewMessageEvent = {
	chatId: number;
	message: Message;
};

let eventSource: EventSource | null = $state(null);
let connected = $state(false);
let isOffline = $state(false);
let offlineTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const messageListeners = new Set<(events: NewMessageEvent[]) => void>();
const contactsReadyListeners = new Set<() => void>();

export function onNewMessages(callback: (events: NewMessageEvent[]) => void) {
	messageListeners.add(callback);
	return () => messageListeners.delete(callback);
}

export function onContactsReady(callback: () => void) {
	contactsReadyListeners.add(callback);
	return () => contactsReadyListeners.delete(callback);
}

export function getConnectionState() {
	return {
		get connected() {
			return connected;
		},
		get isOffline() {
			return isOffline;
		}
	};
}

export function connect() {
	if (eventSource) return;

	eventSource = new EventSource('/api/events');

	eventSource.addEventListener('connected', () => {
		connected = true;
		isOffline = false;
		if (offlineTimer) {
			clearTimeout(offlineTimer);
			offlineTimer = null;
		}
		console.log('SSE connected');
	});

	eventSource.addEventListener('new_messages', (event) => {
		const data: NewMessageEvent[] = JSON.parse(event.data);
		for (const listener of messageListeners) {
			listener(data);
		}
	});

	eventSource.addEventListener('contacts_ready', () => {
		for (const listener of contactsReadyListeners) {
			listener();
		}
	});

	eventSource.onerror = () => {
		connected = false;
		if (!offlineTimer && !isOffline) {
			offlineTimer = setTimeout(() => {
				isOffline = true;
				offlineTimer = null;
			}, 10_000);
		}
		eventSource?.close();
		eventSource = null;
		// Reconnect after 3 seconds
		reconnectTimer = setTimeout(connect, 3000);
	};
}

export function disconnect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (offlineTimer) {
		clearTimeout(offlineTimer);
		offlineTimer = null;
	}
	if (eventSource) {
		eventSource.close();
		eventSource = null;
		connected = false;
	}
}
