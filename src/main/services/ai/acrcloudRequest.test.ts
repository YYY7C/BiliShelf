import { describe, expect, it } from 'vitest';
import { acrcloudSignature } from './acrcloudSignature';
import { acrcloudIdentifyEndpoint, buildAcrCloudIdentifyForm } from './acrcloudRequest';

describe('acrcloudIdentifyEndpoint', () => {
  it('keeps an explicit protocol for local or custom hosts', () => {
    expect(acrcloudIdentifyEndpoint('http://127.0.0.1:9444')).toBe('http://127.0.0.1:9444/v1/identify');
    expect(acrcloudIdentifyEndpoint('https://identify.example.com/')).toBe(
      'https://identify.example.com/v1/identify'
    );
  });

  it('defaults to https for bare ACRCloud hosts', () => {
    expect(acrcloudIdentifyEndpoint('identify-cn-north-1.acrcloud.cn')).toBe(
      'https://identify-cn-north-1.acrcloud.cn/v1/identify'
    );
  });
});

describe('buildAcrCloudIdentifyForm', () => {
  it('sends the sample as binary and includes matching sample_bytes', async () => {
    const sample = Buffer.from([1, 2, 3, 4, 5]);
    const timestamp = 1_800_000_000;
    const form = buildAcrCloudIdentifyForm({
      sample,
      accessKey: 'access-key',
      accessSecret: 'access-secret',
      timestamp,
      filename: 'sample.mp3',
      mime: 'audio/mpeg'
    });

    expect(form.get('access_key')).toBe('access-key');
    expect(form.get('data_type')).toBe('audio');
    expect(form.get('signature_version')).toBe('1');
    expect(form.get('timestamp')).toBe(String(timestamp));
    expect(form.get('signature')).toBe(acrcloudSignature('access-secret', 'access-key', timestamp));
    expect(form.get('sample_bytes')).toBe(String(sample.length));

    const uploaded = form.get('sample');
    expect(uploaded).toBeInstanceOf(Blob);
    expect((uploaded as File).name).toBe('sample.mp3');
    expect(new Uint8Array(await (uploaded as Blob).arrayBuffer())).toEqual(new Uint8Array(sample));
  });
});
