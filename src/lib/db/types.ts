export interface DbChat {
	guid: string;
	chatIdentifier: string;
	displayName: string | null;
	style: number;
	lastMessageDate: number;
	lastMessageText: string | null;
	isArchived: boolean;
	isPinned: boolean;
	unreadCount: number;
	participants: string[]; // handle addresses
}

export interface DbMessage {
	guid: string;
	chatGuid: string;
	text: string | null;
	handleId: number;
	handleAddress: string | null;
	isFromMe: boolean;
	dateCreated: number;
	dateRead: number | null;
	dateDelivered: number | null;
	dateEdited: number | null;
	dateRetracted: number | null;
	subject: string | null;
	associatedMessageGuid: string | null;
	associatedMessageType: number;
	associatedMessageEmoji: string | null;
	threadOriginatorGuid: string | null;
	attachmentGuids: string[];
	error: number;
	expressiveSendStyleId: string | null;
	isDelivered: boolean;
	groupTitle: string | null;
	groupActionType: number;
	isSystemMessage: boolean;
	itemType: number;
	editExpiresAt?: number | null;
	unsendExpiresAt?: number | null;
}

export interface DbHandle {
	address: string;
	service: string;
	country: string;
	displayName: string | null;
	avatarBase64: string | null;
}

export interface DbAttachment {
	guid: string;
	messageGuid: string;
	mimeType: string | null;
	transferName: string | null;
	totalBytes: number;
	width: number | null;
	height: number | null;
	hasLivePhoto: boolean;
	blurhash: string | null;
	isSticker: boolean;
}

export interface DbSyncMeta {
	key: string;
	value: string;
}
