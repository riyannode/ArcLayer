import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { humanJson } from './human-json';
import { GET as healthGET } from '@/app/api/health/route';
import { GET as a2aProfileGET } from '@/app/api/a2a/metadata/profile/route';
import { GET as x402SupportedGET } from '@/app/api/x402/supported/route';

function request(path: string, accept = 'application/json') {
  return new NextRequest(`https://console.test${path}`, {
    headers: { accept },
  });
}

describe('humanJson', () => {
  it('?pretty=1 returns formatted JSON with newlines and indentation', async () => {
    const res = humanJson(request('/api/example?pretty=1'), { ok: true, nested: { value: 1 } });

    await expect(res.text()).resolves.toBe('{\n  "ok": true,\n  "nested": {\n    "value": 1\n  }\n}');
  });

  it('Accept: text/html returns formatted JSON', async () => {
    const res = humanJson(request('/api/example', 'text/html'), { ok: true });

    await expect(res.text()).resolves.toBe('{\n  "ok": true\n}');
  });

  it('Accept: application/json returns compact JSON', async () => {
    const res = humanJson(request('/api/example', 'application/json'), { ok: true });

    await expect(res.text()).resolves.toBe('{"ok":true}');
  });

  it('Accept: */* returns compact JSON', async () => {
    const res = humanJson(request('/api/example', '*/*'), { ok: true });

    await expect(res.text()).resolves.toBe('{"ok":true}');
  });
});

describe('human-readable API route smoke tests', () => {
  it('/api/x402/supported?pretty=1 returns formatted JSON', async () => {
    const res = x402SupportedGET(request('/api/x402/supported?pretty=1'));

    expect(await res.text()).toContain('\n  "kinds":');
  });

  it('/api/health?pretty=1 returns formatted JSON', async () => {
    const res = await healthGET(request('/api/health?pretty=1'));

    expect(await res.text()).toContain('\n  "status": "ok"');
  });

  it('/api/a2a/metadata/profile?pretty=1 returns formatted JSON', async () => {
    const res = await a2aProfileGET(request('/api/a2a/metadata/profile?pretty=1'));

    expect(await res.text()).toContain('\n  \"ok\": false');
  });
});
