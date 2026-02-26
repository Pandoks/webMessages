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

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
	if (timer) clearTimeout(timer);
	return null;
}

function notify<T>(listeners: Set<(payload: T) => void>, payload: T) {
	for (const listener of listeners) listener(payload);
}

function notifyVoid(listeners: Set<() => void>) {
	for (const listener of listeners) listener();
}

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
		offlineTimer = clearTimer(offlineTimer);
		console.log('SSE connected');
	});

	eventSource.addEventListener('new_messages', (event) => {
		const data: NewMessageEvent[] = JSON.parse(event.data);
		notify(messageListeners, data);
	});

	eventSource.addEventListener('contacts_ready', () => {
		notifyVoid(contactsReadyListeners);
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
	reconnectTimer = clearTimer(reconnectTimer);
	offlineTimer = clearTimer(offlineTimer);
	if (eventSource) {
		eventSource.close();
		eventSource = null;
		connected = false;
	}
}
