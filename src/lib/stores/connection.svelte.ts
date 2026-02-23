import type { Message } from '$lib/types/index.js';

type NewMessageEvent = {
	chatId: number;
	message: Message;
};

let eventSource: EventSource | null = $state(null);
let connected = $state(false);
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const messageListeners = new Set<(events: NewMessageEvent[]) => void>();

export function onNewMessages(callback: (events: NewMessageEvent[]) => void) {
	messageListeners.add(callback);
	return () => messageListeners.delete(callback);
}

export function getConnectionState() {
	return {
		get connected() {
			return connected;
		}
	};
}

export function connect() {
	if (eventSource) return;

	eventSource = new EventSource('/api/events');

	eventSource.addEventListener('connected', () => {
		connected = true;
		console.log('SSE connected');
	});

	eventSource.addEventListener('new_messages', (event) => {
		const data: NewMessageEvent[] = JSON.parse(event.data);
		for (const listener of messageListeners) {
			listener(data);
		}
	});

	eventSource.onerror = () => {
		connected = false;
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
	if (eventSource) {
		eventSource.close();
		eventSource = null;
		connected = false;
	}
}
