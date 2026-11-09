// Transport fixtures: real H.264 MP4 + a valid ISO BMFF "free" box to reach exact byte sizes.
// Requires ffmpeg on PATH. No customer video data is used. Artifacts are ignored by Git.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';

mkdirSync('artifacts/upload-tests', { recursive: true });
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  'artifacts/upload-tests/source.mp4'], { stdio: 'ignore' });
const clip = readFileSync('artifacts/upload-tests/source.mp4');
for (const size of [15, 89, 200]) {
  const target = size * 1024 * 1024;
  const path = `artifacts/upload-tests/video-${size}MiB.mp4`;
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, clip);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(target - clip.length);
    header.write('free', 4);
    writeSync(fd, header);
    const chunk = Buffer.alloc(1024 * 1024);
    for (let remaining = target - clip.length - 8; remaining > 0;) {
      const bytes = Math.min(remaining, chunk.length);
      writeSync(fd, chunk, 0, bytes);
      remaining -= bytes;
    }
  } finally { closeSync(fd); }
  console.log(`${path}: ${target} bytes`);
}
