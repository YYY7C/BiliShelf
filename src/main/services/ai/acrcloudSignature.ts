import crypto from 'node:crypto';

export function acrcloudStringToSign(accessKey: string, timestamp: number): string {
  return `POST\n/v1/identify\n${accessKey}\naudio\n1\n${timestamp}`;
}

export function acrcloudSignature(accessSecret: string, accessKey: string, timestamp: number): string {
  return crypto
    .createHmac('sha1', accessSecret)
    .update(acrcloudStringToSign(accessKey, timestamp))
    .digest('base64');
}
