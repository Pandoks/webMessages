export type SSEEventHandler = (type: string, data: unknown) => void;

export class SSEClient {
	private source: EventSource | null = null;
	private handlers: SSEEventHandler[] = [];

	connect(url: string) {
		this.disconnect();
		this.source = new EventSource(url);

		this.source.onopen = () => {
			console.log('[SSE] Connected');
		};

		this.source.onerror = () => {
			console.warn('[SSE] Connection error, will auto-reconnect');
		};

		const eventTypes = [
			'new-message',
			'updated-message',
			'typing-indicator',
			'chat-read-status-changed',
			'group-name-change',
			'participant-added',
			'participant-removed',
			'participant-left'
		];

		for (const type of eventTypes) {
			this.source.addEventListener(type, (e) => {
				const data = JSON.parse((e as MessageEvent).data);
				for (const handler of this.handlers) {
					handler(type, data);
				}
			});
		}
	}

	onEvent(handler: SSEEventHandler) {
		this.handlers.push(handler);
	}

	disconnect() {
		this.source?.close();
		this.source = null;
	}
}
