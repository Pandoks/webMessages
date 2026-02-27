export interface Handle {
	originalROWID: number;
	address: string;
	service: string;
	uncanonicalizedId: string | null;
	country: string;
}

export interface Attachment {
	originalROWID: number;
	guid: string;
	uti: string | null;
	mimeType: string | null;
	transferName: string | null;
	totalBytes: number;
	transferState: number;
	isOutgoing: boolean;
	hideAttachment: boolean;
	isSticker: boolean;
	originalGuid: string | null;
	hasLivePhoto: boolean;
	height: number | null;
	width: number | null;
	metadata: Record<string, unknown> | null;
}

export interface Message {
	originalROWID: number;
	guid: string;
	text: string | null;
	attributedBody: unknown[];
	handle: Handle | null;
	handleId: number;
	otherHandle: number;
	attachments: Attachment[];
	subject: string | null;
	error: number;
	dateCreated: number;
	dateRead: number | null;
	dateDelivered: number | null;
	isDelivered: boolean;
	isFromMe: boolean;
	hasDdResults: boolean;
	isArchived: boolean;
	itemType: number;
	groupTitle: string | null;
	groupActionType: number;
	balloonBundleId: string | null;
	associatedMessageGuid: string | null;
	associatedMessageType: number;
	associatedMessageEmoji: string | null;
	expressiveSendStyleId: string | null;
	threadOriginatorGuid: string | null;
	threadOriginatorPart: string | null;
	hasPayloadData: boolean;
	isDelayed: boolean;
	isAutoReply: boolean;
	isSystemMessage: boolean;
	isServiceMessage: boolean;
	isForward: boolean;
	isCorrupt: boolean;
	datePlayed: number | null;
	isSpam: boolean;
	isExpired: boolean;
	isAudioMessage: boolean;
	replyToGuid: string | null;
	shareStatus: number;
	shareDirection: number;
	wasDeliveredQuietly: boolean;
	didNotifyRecipient: boolean;
	chats: Chat[];
	dateEdited: number | null;
	dateRetracted: number | null;
	partCount: number | null;
}

export interface Chat {
	originalROWID: number;
	guid: string;
	style: number; // 43 = group, 45 = 1:1
	chatIdentifier: string;
	isArchived: boolean;
	displayName: string | null;
	participants: Handle[];
	messages: Message[];
	isFiltered: boolean;
	groupId: string | null;
	lastMessage?: Message | null;
}

export interface Contact {
	address: string;
	displayName: string | null;
	avatarBase64: string | null;
}

export interface FindMyDevice {
	id: string;
	name: string;
	batteryLevel: number | null;
	batteryStatus: string | null;
	latitude: number | null;
	longitude: number | null;
	address: string | null;
	locationTimestamp: number | null;
	isLocating: boolean;
	modelDisplayName: string | null;
}

export interface FindMyFriend {
	id: string;
	handle: string;
	firstName: string | null;
	lastName: string | null;
	latitude: number | null;
	longitude: number | null;
	address: string | null;
	locationTimestamp: number | null;
	locatingInProgress: boolean;
}

export interface ApiResponse<T> {
	status: number;
	message: string;
	data: T;
}

export interface WebhookEvent {
	type: string;
	data: unknown;
}
