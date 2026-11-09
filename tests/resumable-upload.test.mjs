import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadEndpoint, uploadError, VIDEO_UPLOAD_BYTES, DOCUMENT_UPLOAD_BYTES } from '../src/services/resumable-upload.ts';

test('uploads use direct Supabase storage hostname while local and custom domains remain local', () => {
  assert.equal(uploadEndpoint('https://abc123.supabase.co'), 'https://abc123.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(uploadEndpoint('http://127.0.0.1:56421'), 'http://127.0.0.1:56421/storage/v1/upload/resumable');
  assert.equal(uploadEndpoint('https://storage.example.test'), 'https://storage.example.test/storage/v1/upload/resumable');
  assert.equal(VIDEO_UPLOAD_BYTES, 209715200);
  assert.equal(DOCUMENT_UPLOAD_BYTES, 52428800);
});
test('storage failures distinguish project size limits, permission denial and retryable interruptions', () => {
  const failure = (status, message) => Object.assign(new Error('technical error'), { originalResponse: { getStatus: () => status, getBody: () => JSON.stringify({ message }) } });
  assert.match(uploadError(failure(413, 'exceeded maximum allowed size')).message, /project global limit.*bucket/);
  assert.match(uploadError(failure(403, 'row-level security')).message, /Storage denied.*403.*permissions.*row-level security/);
  assert.match(uploadError(failure(400, 'mime type application/octet-stream is not supported')).message, /does not allow this file type/);
  assert.match(uploadError(failure(503, 'unavailable')).message, /interrupted.*503.*Resume/);
  assert.match(uploadError(new Error('offline')).message, /Resume/);
});
