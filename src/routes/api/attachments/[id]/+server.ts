import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachmentById } from '$lib/server/queries/attachments.js';
import { existsSync, createReadStream, mkdirSync, rmSync } from 'fs';
import { stat, rename } from 'fs/promises';
import { homedir } from 'os';
import { join, extname, basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(homedir(), '.cache', 'webMessages');
const transcodeInFlight = new Map<number, Promise<string | null>>();
const validatedTranscodes = new Set<number>();

function resolveFilePath(filename: string): string {
	// Replace ~ with home dir
	if (filename.startsWith('~')) {
		return join(homedir(), filename.slice(1));
	}
	return filename;
}

function sanitizeFilename(name: string): string {
	const cleaned = name
		.replace(/[/\\?%*:|"<>]/g, '_')
		.replace(/[\r\n\t]/g, ' ')
		.trim();
	return cleaned || 'attachment';
}

function ensureExtension(filename: string, desiredExt: string): string {
	const safeExt = desiredExt.startsWith('.') ? desiredExt : `.${desiredExt}`;
	const currentExt = extname(filename);
	if (currentExt.toLowerCase() === safeExt.toLowerCase()) return filename;
	if (!currentExt) return `${filename}${safeExt}`;
	return `${filename.slice(0, -currentExt.length)}${safeExt}`;
}

function buildContentDisposition(filename: string, mode: 'inline' | 'attachment'): string {
	const safeName = sanitizeFilename(filename);
	const asciiFallback = safeName
		.normalize('NFKD')
		.replace(/[^\x20-\x7E]/g, '_')
		.replace(/["\\]/g, '_');
	const utf8Encoded = encodeURIComponent(safeName).replace(/\*/g, '%2A');
	return `${mode}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

function isQuickTimeVideo(filePath: string, mimeType: string, uti: string | null): boolean {
	const ext = extname(filePath).toLowerCase();
	if (uti === 'com.apple.quicktime-movie') return true;
	if (mimeType === 'video/quicktime') return true;
	return ext === '.mov';
}

async function transcodeVideoToMp4(filePath: string, attachmentId: number): Promise<string | null> {
	const videoCacheDir = join(CACHE_DIR, 'videos');
	mkdirSync(videoCacheDir, { recursive: true });
	const cachedPath = join(videoCacheDir, `${attachmentId}.mp4`);

	if (existsSync(cachedPath)) {
		if (validatedTranscodes.has(attachmentId)) return cachedPath;
		try {
			const { stdout } = await execFileAsync(
				'ffprobe',
				[
					'-v',
					'error',
					'-select_streams',
					'v:0',
					'-show_entries',
					'stream=codec_name',
					'-of',
					'default=noprint_wrappers=1:nokey=1',
					cachedPath
				],
				{ timeout: 5000, maxBuffer: 1024 * 1024 }
			);
			if (stdout.trim().length > 0) {
				validatedTranscodes.add(attachmentId);
				return cachedPath;
			}
		} catch {
			// Regenerate if probe fails or file is malformed.
		}
		rmSync(cachedPath, { force: true });
	}

	const inFlight = transcodeInFlight.get(attachmentId);
	if (inFlight) return inFlight;

	const job = (async () => {
		const tempPath = join(videoCacheDir, `${attachmentId}.${Date.now()}.tmp.mp4`);
		try {
			await execFileAsync(
				'ffmpeg',
				[
					'-y',
					'-i',
					filePath,
					'-map',
					'0:v:0',
					'-map',
					'0:a?',
					'-c:v',
					'libx264',
					'-preset',
					'veryfast',
					'-crf',
					'23',
					'-pix_fmt',
					'yuv420p',
					'-c:a',
					'aac',
					'-b:a',
					'128k',
					'-movflags',
					'+faststart',
					tempPath
				],
				{
					timeout: 300000,
					maxBuffer: 8 * 1024 * 1024
				}
			);

			if (existsSync(cachedPath)) {
				rmSync(tempPath, { force: true });
				validatedTranscodes.add(attachmentId);
				return cachedPath;
			}

			await rename(tempPath, cachedPath);
			validatedTranscodes.add(attachmentId);
			return cachedPath;
		} catch (err) {
			rmSync(tempPath, { force: true });
			console.error('Video transcode failed:', err);
			return null;
		} finally {
			transcodeInFlight.delete(attachmentId);
		}
	})();

	transcodeInFlight.set(attachmentId, job);
	return job;
}

function parseByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
	const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
	if (!match) return null;

	const [, startStr, endStr] = match;
	if (!startStr && !endStr) return null;

	let start = 0;
	let end = fileSize - 1;

	if (startStr) {
		start = Number.parseInt(startStr, 10);
		if (!Number.isFinite(start) || Number.isNaN(start)) return null;
		if (endStr) {
			end = Number.parseInt(endStr, 10);
			if (!Number.isFinite(end) || Number.isNaN(end)) return null;
		}
	} else if (endStr) {
		const suffixLength = Number.parseInt(endStr, 10);
		if (!Number.isFinite(suffixLength) || Number.isNaN(suffixLength) || suffixLength <= 0) return null;
		start = Math.max(fileSize - suffixLength, 0);
		end = fileSize - 1;
	}

	if (start < 0 || end < start || start >= fileSize) return null;
	if (end >= fileSize) end = fileSize - 1;
	return { start, end };
}

function streamFile(filePath: string, start?: number, end?: number): ReadableStream<Uint8Array> {
	const stream = createReadStream(filePath, start !== undefined && end !== undefined ? { start, end } : undefined);
	return new ReadableStream({
		start(controller) {
			stream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
			stream.on('end', () => controller.close());
			stream.on('error', (err) => controller.error(err));
		},
		cancel() {
			stream.destroy();
		}
	});
}

export const GET: RequestHandler = async ({ params, request, url }) => {
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
	let downloadName = sanitizeFilename(attachment.transfer_name ?? basename(filePath) ?? `attachment-${attachment.rowid}`);

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
		downloadName = ensureExtension(downloadName, '.jpg');
	}

	// Browser compatibility: convert QuickTime videos to MP4/H.264 once, then serve cached output.
	const shouldTranscodeVideo =
		(attachment.mime_type?.startsWith('video/') ?? false) &&
		isQuickTimeVideo(filePath, attachment.mime_type ?? '', attachment.uti);
	if (shouldTranscodeVideo) {
		const transcodedPath = await transcodeVideoToMp4(filePath, attachment.rowid);
		if (transcodedPath) {
			servePath = transcodedPath;
			mimeType = 'video/mp4';
			downloadName = ensureExtension(downloadName, '.mp4');
		}
	}

	const fileStat = await stat(servePath);
	const downloadRequested = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true';
	const baseHeaders: Record<string, string> = {
		'Content-Type': mimeType,
		'Accept-Ranges': 'bytes',
		'Content-Disposition': buildContentDisposition(downloadName, downloadRequested ? 'attachment' : 'inline'),
		'Cache-Control': 'public, max-age=86400'
	};

	const rangeHeader = request.headers.get('range');
	if (rangeHeader) {
		const parsed = parseByteRange(rangeHeader, fileStat.size);
		if (!parsed) {
			return new Response('Requested Range Not Satisfiable', {
				status: 416,
				headers: {
					...baseHeaders,
					'Content-Range': `bytes */${fileStat.size}`
				}
			});
		}

		const { start, end } = parsed;
		const contentLength = end - start + 1;
		return new Response(streamFile(servePath, start, end), {
			status: 206,
			headers: {
				...baseHeaders,
				'Content-Length': contentLength.toString(),
				'Content-Range': `bytes ${start}-${end}/${fileStat.size}`
			}
		});
	}

	return new Response(streamFile(servePath), {
		headers: {
			...baseHeaders,
			'Content-Length': fileStat.size.toString()
		}
	});
};
