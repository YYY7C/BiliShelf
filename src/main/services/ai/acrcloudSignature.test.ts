import { describe, expect, it } from 'vitest';
import { acrcloudSignature, acrcloudStringToSign } from './acrcloudSignature';

describe('acrcloudSignature', () => {
  it('builds the documented string to sign', () => {
    expect(acrcloudStringToSign('key', 1700000000)).toBe('POST\n/v1/identify\nkey\naudio\n1\n1700000000');
  });

  it('matches the known HMAC-SHA1 base64 vector', () => {
    expect(acrcloudSignature('secret', 'key', 1700000000)).toBe('tWbqxXkbyadGeaHIJS/OzfF+KdU=');
  });
});
