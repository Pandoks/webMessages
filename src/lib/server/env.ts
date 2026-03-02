import { env } from '$env/dynamic/private';
import { join, resolve } from 'node:path';

export const IMESSAGE_RS_URL = env.IMESSAGE_RS_URL ?? 'http://127.0.0.1:1234';
if (!env.IMESSAGE_RS_PASSWORD) {
	throw new Error('IMESSAGE_RS_PASSWORD environment variable is required');
}
export const IMESSAGE_RS_PASSWORD = env.IMESSAGE_RS_PASSWORD;

const BIN_DIR = env.WEBMESSAGES_BIN_DIR;
export const IMCORE_BRIDGE = BIN_DIR
	? join(BIN_DIR, 'imcore-bridge')
	: resolve('src/lib/server/imcore-bridge');
export const PINNED_CHATS = BIN_DIR
	? join(BIN_DIR, 'pinned-chats')
	: resolve('src/lib/server/pinned-chats');
export const REVERSE_GEOCODE = BIN_DIR
	? join(BIN_DIR, 'reverse-geocode')
	: resolve('src/lib/server/reverse-geocode');
