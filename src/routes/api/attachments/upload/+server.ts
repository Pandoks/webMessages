import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { sendAttachment } from '$lib/server/send.js';

const UPLOAD_DIR = join(tmpdir(), 'webMessages-uploads');

export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get('file');
  const chatGuid = formData.get('chatGuid');

  if (!file || !(file instanceof File)) {
    error(400, 'File is required');
  }

  if (!chatGuid || typeof chatGuid !== 'string') {
    error(400, 'chatGuid is required');
  }

  try {
    // Save file to temp directory
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${Date.now()}-${file.name}`;
    const filepath = join(UPLOAD_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    // Send via AppleScript
    await sendAttachment(chatGuid, filepath);

    return json({ success: true });
  } catch (err) {
    console.error('Upload error:', err);
    return json({ error: 'Failed to send attachment' }, { status: 500 });
  }
};
