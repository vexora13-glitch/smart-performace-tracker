// Malware scanning for Vexbot uploads. Fails closed: with no scanner configured, or on any scanner error,
// the upload stays quarantined. Only an explicit clean verdict can release it.
import net from 'node:net';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** clamd INSTREAM over TCP. Resolves { clean: boolean, signature? } or rejects on any failure. */
function clamd(host, port, bytes, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = '';
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Scanner timed out')));
    socket.on('error', reject);
    socket.on('data', (data) => { response += data.toString('utf8'); });
    socket.on('end', () => {
      const text = response.split(String.fromCharCode(0)).join('').trim();
      if (/^stream: OK$/.test(text)) resolve({ clean: true });
      else if (/FOUND$/.test(text)) resolve({ clean: false, signature: text.replace(/^stream: /, '').replace(/ FOUND$/, '').slice(0, 120) });
      else reject(new Error('Unexpected scanner response'));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const part = bytes.subarray(offset, offset + 65536), size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size); socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

/**
 * Returns a scanner, or null when none is configured. The mock flags the EICAR test string and is refused
 * on Vercel production so it can never stand in for real scanning there.
 */
export function createScanner(env = process.env) {
  const kind = env.VEXBOT_SCANNER || (env.VEXBOT_CLAMD_HOST ? 'clamd' : '');
  if (kind === 'clamd' && env.VEXBOT_CLAMD_HOST) {
    const port = Number(env.VEXBOT_CLAMD_PORT || 3310);
    return { name: 'clamd', scan: (bytes) => clamd(env.VEXBOT_CLAMD_HOST, port, bytes) };
  }
  if (kind === 'mock' && env.VERCEL_ENV !== 'production') {
    return { name: 'mock', scan: async (bytes) => (bytes.includes(Buffer.from(EICAR)) ? { clean: false, signature: 'Eicar-Test-Signature (mock)' } : { clean: true }) };
  }
  return null;
}
export { EICAR };
