import type { Chat, Message, Handle, Attachment } from '$lib/types/index.js';
import type { DbChat, DbMessage, DbHandle, DbAttachment } from '$lib/db/types.js';

export function chatToDb(chat: Chat): DbChat {
	return {
		guid: chat.guid,
		chatIdentifier: chat.chatIdentifier,
		displayName: chat.displayName,
		style: chat.style,
		lastMessageDate: chat.lastMessage?.dateCreated ?? 0,
		lastMessageText: chat.lastMessage?.text ?? null,
		isArchived: chat.isArchived,
		isPinned: false,
		unreadCount: 0,
		participants: chat.participants?.map((p) => p.address) ?? []
	};
}

export function messageToDb(msg: Message, chatGuidOverride?: string): DbMessage {
	return {
		guid: msg.guid,
		chatGuid: chatGuidOverride ?? msg.chats?.[0]?.guid ?? '',
		text: msg.text,
		handleId: msg.handleId,
		handleAddress: msg.handle?.address ?? null,
		isFromMe: msg.isFromMe,
		dateCreated: msg.dateCreated,
		dateRead: msg.dateRead,
		dateDelivered: msg.dateDelivered,
		dateEdited: msg.dateEdited,
		dateRetracted: msg.dateRetracted,
		subject: msg.subject,
		associatedMessageGuid: msg.associatedMessageGuid,
		associatedMessageType: msg.associatedMessageType ?? 0,
		associatedMessageEmoji: msg.associatedMessageEmoji,
		threadOriginatorGuid: msg.threadOriginatorGuid,
		attachmentGuids: msg.attachments?.map((a) => a.guid) ?? [],
		error: msg.error ?? 0,
		expressiveSendStyleId: msg.expressiveSendStyleId,
		isDelivered: msg.isDelivered,
		groupTitle: msg.groupTitle,
		groupActionType: msg.groupActionType ?? 0,
		isSystemMessage: msg.isSystemMessage,
		itemType: msg.itemType ?? 0
	};
}

export function handleToDb(handle: Handle): DbHandle {
	return {
		address: handle.address,
		service: handle.service,
		country: handle.country,
		displayName: null,
		avatarBase64: null
	};
}

export function attachmentToDb(attachment: Attachment, messageGuid: string): DbAttachment {
	return {
		guid: attachment.guid,
		messageGuid,
		mimeType: attachment.mimeType,
		transferName: attachment.transferName,
		totalBytes: attachment.totalBytes,
		width: attachment.width,
		height: attachment.height,
		hasLivePhoto: attachment.hasLivePhoto,
		blurhash: null,
		isSticker: attachment.isSticker
	};
}
