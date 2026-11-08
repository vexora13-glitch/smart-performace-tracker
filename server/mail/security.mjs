import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export class MailError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
export function secretKey(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new MailError('invalid_encryption_configuration', 503);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new MailError('invalid_encryption_configuration', 503);
  return key;
}
export function tokenCipher(keys, activeKeyId) {
  if (!keys?.[activeKeyId]) throw new MailError('missing_encryption_key', 503);
  for (const key of Object.values(keys)) secretKey(key);
  return {
    seal(value, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secretKey(keys[activeKeyId]), iv);
      cipher.setAAD(Buffer.from(`vexora-mail:v1:${context}`));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      return {
        v: 1,
        kid: activeKeyId,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      };
    },
    open(envelope, context) {
      try {
        if (envelope.v !== 1 || !keys[envelope.kid]) throw new Error();
        const decipher = createDecipheriv(
          'aes-256-gcm',
          secretKey(keys[envelope.kid]),
          Buffer.from(envelope.iv, 'base64'),
        );
        decipher.setAAD(Buffer.from(`vexora-mail:v1:${context}`));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        return JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
            decipher.final(),
          ]).toString('utf8'),
        );
      } catch {
        throw new MailError('credential_decryption_failed', 503);
      }
    },
  };
}
export function oauthState(key, now = () => Date.now()) {
  const signingKey = secretKey(key);
  return {
    issue({ organisationId, connectionId, actorId }) {
      const claims = {
        v: 1,
        purpose: 'vexora-gmail',
        organisationId,
        connectionId,
        actorId,
        nonce: randomSecret(),
        exp: now() + 600000,
      };
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${payload}.${createHmac('sha256', signingKey).update(payload).digest('base64url')}`;
    },
    verify(value) {
      try {
        if (typeof value !== 'string' || value.length > 2048) throw new Error();
        const [payload, signature, ...rest] = value.split('.');
        if (rest.length) throw new Error();
        const expected = createHmac('sha256', signingKey).update(payload).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
          throw new Error();
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (
          claims.v !== 1 ||
          claims.purpose !== 'vexora-gmail' ||
          !claims.nonce ||
          !Number.isFinite(claims.exp) ||
          claims.exp <= now() ||
          claims.exp > now() + 600000
        )
          throw new Error();
        return claims;
      } catch {
        throw new MailError('invalid_oauth_state');
      }
    },
  };
}
