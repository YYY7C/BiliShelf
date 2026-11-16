import { acrcloudSignature } from './acrcloudSignature';

export function acrcloudIdentifyEndpoint(host: string): string {
  const base = host.trim().replace(/\/+$/, '');
  if (!base) throw new Error('ACRCloud host 不能为空');
  return /^https?:\/\//i.test(base) ? `${base}/v1/identify` : `https://${base}/v1/identify`;
}

export interface AcrCloudIdentifyFormInput {
  sample: Buffer;
  accessKey: string;
  accessSecret: string;
  timestamp: number;
  filename?: string;
  mime?: string;
}

/**
 * ACRCloud identify API 要求 multipart 中 sample 是二进制文件，
 * 同时附带与文件大小一致的 sample_bytes。
 */
export function buildAcrCloudIdentifyForm(input: AcrCloudIdentifyFormInput): FormData {
  const form = new FormData();
  form.append('access_key', input.accessKey);
  form.append('data_type', 'audio');
  form.append('signature_version', '1');
  form.append('signature', acrcloudSignature(input.accessSecret, input.accessKey, input.timestamp));
  form.append(
    'sample',
    new Blob([new Uint8Array(input.sample)], { type: input.mime ?? 'audio/mpeg' }),
    input.filename ?? 'sample.mp3'
  );
  form.append('sample_bytes', String(input.sample.length));
  form.append('timestamp', String(input.timestamp));
  return form;
}
