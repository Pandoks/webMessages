export type SSEEventHandler = (type: string, data: unknown) => void | Promise<void>;

export class SSEClient {
	private source: EventSource | null = null;
	private handlers: SSEEventHandler[] = [];
	private reconnectHandler: (() => void) | null = null;
	private hasConnected = false;

	connect(url: string) {
		this.disconnect();
		this.hasConnected = false;
		this.source = new EventSource(url);

		this.source.onopen = () => {
			if (this.hasConnected) {
				console.log('[SSE] Reconnected');
				this.reconnectHandler?.();
			} else {
				console.log('[SSE] Connected');
				this.hasConnected = true;
			}
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
			'participant-left',
			'new-findmy-location'
		];

		for (const type of eventTypes) {
			this.source.addEventListener(type, (e) => {
				let data: unknown;
				try {
					data = JSON.parse((e as MessageEvent).data);
				} catch (err) {
					console.error(`[SSE] Failed to parse ${type} event data:`, err);
					return;
				}
				for (const handler of this.handlers) {
					try {
						const result = handler(type, data);
						if (result instanceof Promise) {
							result.catch((err) => console.error(`[SSE] Handler error for ${type}:`, err));
						}
					} catch (err) {
						console.error(`[SSE] Sync handler error for ${type}:`, err);
					}
				}
			});
		}
	}

	onEvent(handler: SSEEventHandler) {
		this.handlers.push(handler);
	}

	onReconnect(handler: () => void) {
		this.reconnectHandler = handler;
	}

	disconnect() {
		this.source?.close();
		this.source = null;
	}
}
