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
const CACHE_DIR = join(homedir(), '.cache', 'webMessages', 'thumbnails');

function resolveFilePath(filename: string): string {
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
	if (!existsSync(filePath)) error(404, 'Attachment file not found');

	mkdirSync(CACHE_DIR, { recursive: true });
	const cachedPath = join(CACHE_DIR, `${attachment.rowid}.jpg`);

	if (!existsSync(cachedPath)) {
		try {
			const ext = extname(filePath).toLowerCase();
			let sourcePath = filePath;

			// For HEIC, first convert to a temp JPEG, then resize
			if (ext === '.heic' || ext === '.heif' || attachment.uti === 'public.heic') {
				const tempPath = join(CACHE_DIR, `${attachment.rowid}_temp.jpg`);
				await execFileAsync('sips', ['-s', 'format', 'jpeg', filePath, '--out', tempPath], {
					timeout: 15000
				});
				sourcePath = tempPath;
			}

			await execFileAsync(
				'sips',
				['--resampleWidth', '600', '-s', 'format', 'jpeg', sourcePath, '--out', cachedPath],
				{ timeout: 15000 }
			);
		} catch (err) {
			console.error('Thumbnail generation failed:', err);
			error(500, 'Failed to generate thumbnail');
		}
	}

	const fileStat = await stat(cachedPath);
	const stream = createReadStream(cachedPath);
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
			'Content-Type': 'image/jpeg',
			'Content-Length': fileStat.size.toString(),
			'Cache-Control': 'public, max-age=86400'
		}
	});
};
