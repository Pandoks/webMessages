import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachmentById } from '$lib/server/queries/attachments.js';
import { existsSync, createReadStream, mkdirSync } from 'fs';
import { stat } from 'fs/promises';
import { homedir } from 'os';
import { join, extname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(homedir(), '.cache', 'webMessages');

function resolveFilePath(filename: string): string {
	// Replace ~ with home dir
	if (filename.startsWith('~')) {
		return join(homedir(), filename.slice(1));
	}
	return filename;
}

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) error(400, 'Invalid attachment ID');

	const attachment = getAttachmentById(id);
	if (!attachment || !attachment.filename) error(404, 'Attachment not found');

	const filePath = resolveFilePath(attachment.filename);

	if (!existsSync(filePath)) {
		error(404, 'Attachment file not found');
	}

	const ext = extname(filePath).toLowerCase();
	let servePath = filePath;
	let mimeType = attachment.mime_type ?? 'application/octet-stream';

	// Convert HEIC to JPEG
	if (ext === '.heic' || ext === '.heif' || attachment.uti === 'public.heic') {
		mkdirSync(CACHE_DIR, { recursive: true });
		const cachedPath = join(CACHE_DIR, `${attachment.rowid}.jpg`);

		if (!existsSync(cachedPath)) {
			try {
				await execFileAsync('sips', ['-s', 'format', 'jpeg', filePath, '--out', cachedPath], {
					timeout: 15000
				});
			} catch (err) {
				console.error('HEIC conversion failed:', err);
				error(500, 'Failed to convert HEIC image');
			}
		}

		servePath = cachedPath;
		mimeType = 'image/jpeg';
	}

	const fileStat = await stat(servePath);
	const stream = createReadStream(servePath);
	const webStream = new ReadableStream({
		start(controller) {
			stream.on('data', (chunk) => controller.enqueue(chunk));
			stream.on('end', () => controller.close());
			stream.on('error', (err) => controller.error(err));
		},
		cancel() {
			stream.destroy();
		}
	});

	return new Response(webStream, {
		headers: {
			'Content-Type': mimeType,
			'Content-Length': fileStat.size.toString(),
			'Cache-Control': 'public, max-age=86400'
		}
	});
};
