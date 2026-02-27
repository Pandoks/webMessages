export interface SendTextRequest {
	chatGuid: string;
	tempGuid?: string;
	message: string;
	method?: 'private-api' | 'apple-script';
	effectId?: string;
	subject?: string;
	selectedMessageGuid?: string;
	partIndex?: number;
}

export interface ReactRequest {
	chatGuid: string;
	selectedMessageGuid: string;
	reaction: 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question' | string;
	partIndex?: number;
}

export interface ChatQueryRequest {
	guid?: string;
	with?: string[];
	sort?: string;
	offset?: number;
	limit?: number;
}

export interface MessageQueryRequest {
	chatGuid?: string;
	with?: string[];
	offset?: number;
	limit?: number;
	sort?: 'ASC' | 'DESC';
	after?: string;
	before?: string;
}

export interface CreateChatRequest {
	addresses: string[];
	message?: string;
	method?: 'private-api' | 'apple-script';
	service?: 'iMessage' | 'SMS';
	tempGuid?: string;
}
