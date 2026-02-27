import { env } from '$env/dynamic/private';

export const IMESSAGE_RS_URL = env.IMESSAGE_RS_URL ?? 'http://127.0.0.1:1234';
if (!env.IMESSAGE_RS_PASSWORD) {
	throw new Error('IMESSAGE_RS_PASSWORD environment variable is required');
}
export const IMESSAGE_RS_PASSWORD = env.IMESSAGE_RS_PASSWORD;
