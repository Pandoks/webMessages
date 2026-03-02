import type {
	ApiResponse,
	Chat,
	Message,
	Attachment,
	Contact,
	FindMyDevice,
	FindMyFriend
} from '$lib/types/index.js';
import type {
	SendTextRequest,
	ReactRequest,
	ChatQueryRequest,
	MessageQueryRequest,
	CreateChatRequest
} from '$lib/types/api.js';

export class ImessageClient {
	private baseUrl: string;
	private password: string;

	constructor(baseUrl: string, password: string) {
		this.baseUrl = baseUrl;
		this.password = password;
	}

	buildUrl(path: string): string {
		const url = new URL(path, this.baseUrl);
		url.searchParams.set('password', this.password);
		return url.toString();
	}

	async get<T>(path: string): Promise<ApiResponse<T>> {
		const response = await fetch(this.buildUrl(path), { method: 'GET' });
		return response.json() as Promise<ApiResponse<T>>;
	}

	async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const response = await fetch(this.buildUrl(path), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
		return response.json() as Promise<ApiResponse<T>>;
	}

	async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const response = await fetch(this.buildUrl(path), {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
		return response.json() as Promise<ApiResponse<T>>;
	}

	async delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const response = await fetch(this.buildUrl(path), {
			method: 'DELETE',
			headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
		return response.json() as Promise<ApiResponse<T>>;
	}

	async stream(path: string): Promise<Response> {
		return fetch(this.buildUrl(path), { method: 'GET' });
	}

	// Convenience methods

	ping(): Promise<ApiResponse<string>> {
		return this.get<string>('/api/v1/ping');
	}

	queryChats(query: ChatQueryRequest): Promise<ApiResponse<Chat[]>> {
		return this.post<Chat[]>('/api/v1/chat/query', query);
	}

	getChat(guid: string): Promise<ApiResponse<Chat>> {
		return this.get<Chat>(`/api/v1/chat/${encodeURIComponent(guid)}?with=participants,lastMessage`);
	}

	getChatMessages(
		guid: string,
		params?: {
			limit?: number;
			offset?: number;
			sort?: 'ASC' | 'DESC';
			after?: string;
			before?: string;
			with?: string[];
		}
	): Promise<ApiResponse<Message[]>> {
		const searchParams = new URLSearchParams();
		if (params) {
			if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
			if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
			if (params.sort) searchParams.set('sort', params.sort);
			if (params.after) searchParams.set('after', params.after);
			if (params.before) searchParams.set('before', params.before);
			if (params.with) searchParams.set('with', params.with.join(','));
		}
		const query = searchParams.toString();
		const path = `/api/v1/chat/${encodeURIComponent(guid)}/message${query ? `?${query}` : ''}`;
		return this.get<Message[]>(path);
	}

	queryMessages(query: MessageQueryRequest): Promise<ApiResponse<Message[]>> {
		return this.post<Message[]>('/api/v1/message/query', query);
	}

	getMessage(guid: string): Promise<ApiResponse<Message>> {
		return this.get<Message>(`/api/v1/message/${encodeURIComponent(guid)}`);
	}

	sendText(request: SendTextRequest): Promise<ApiResponse<Message>> {
		return this.post<Message>('/api/v1/message/text', request);
	}

	react(request: ReactRequest): Promise<ApiResponse<Message>> {
		return this.post<Message>('/api/v1/message/react', request);
	}

	editMessage(
		guid: string,
		newText: string,
		backwardsCompatMessage: string
	): Promise<ApiResponse<Message>> {
		return this.post<Message>(`/api/v1/message/${encodeURIComponent(guid)}/edit`, {
			editedMessage: newText,
			backwardsCompatibilityMessage: backwardsCompatMessage
		});
	}

	unsendMessage(guid: string): Promise<ApiResponse<Message>> {
		return this.post<Message>(`/api/v1/message/${encodeURIComponent(guid)}/unsend`);
	}

	createChat(request: CreateChatRequest): Promise<ApiResponse<Chat>> {
		return this.post<Chat>('/api/v1/chat/new', request);
	}

	deleteChat(guid: string): Promise<ApiResponse<void>> {
		return this.delete<void>(`/api/v1/chat/${encodeURIComponent(guid)}`);
	}

	markRead(guid: string): Promise<ApiResponse<Chat>> {
		return this.post<Chat>(`/api/v1/chat/${encodeURIComponent(guid)}/read`);
	}

	markUnread(guid: string): Promise<ApiResponse<Chat>> {
		return this.post<Chat>(`/api/v1/chat/${encodeURIComponent(guid)}/unread`);
	}

	startTyping(guid: string): Promise<ApiResponse<void>> {
		return this.post<void>(`/api/v1/chat/${encodeURIComponent(guid)}/typing`);
	}

	stopTyping(guid: string): Promise<ApiResponse<void>> {
		return this.delete<void>(`/api/v1/chat/${encodeURIComponent(guid)}/typing`);
	}

	downloadAttachment(guid: string): Promise<Response> {
		return this.stream(`/api/v1/attachment/${encodeURIComponent(guid)}/download`);
	}

	getAttachmentInfo(guid: string): Promise<ApiResponse<Attachment>> {
		return this.get<Attachment>(`/api/v1/attachment/${encodeURIComponent(guid)}`);
	}

	getContact(address: string): Promise<ApiResponse<Contact>> {
		return this.get<Contact>(`/api/v1/icloud/contact?address=${encodeURIComponent(address)}`);
	}

	getDevices(): Promise<ApiResponse<FindMyDevice[]>> {
		return this.get<FindMyDevice[]>('/api/v1/icloud/findmy/devices');
	}

	refreshDevices(): Promise<ApiResponse<FindMyDevice[]>> {
		return this.post<FindMyDevice[]>('/api/v1/icloud/findmy/devices/refresh');
	}

	getFriends(): Promise<ApiResponse<FindMyFriend[]>> {
		return this.get<FindMyFriend[]>('/api/v1/icloud/findmy/friends');
	}

	refreshFriends(): Promise<ApiResponse<FindMyFriend[]>> {
		return this.post<FindMyFriend[]>('/api/v1/icloud/findmy/friends/refresh');
	}

	leaveChat(guid: string): Promise<ApiResponse<void>> {
		return this.post<void>(`/api/v1/chat/${encodeURIComponent(guid)}/leave`);
	}
}
