import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const sources = walk(join(__dirname, '../../src')).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { dependencies: Record<string, string> };

/** The privacy promises are enforced here, so that a later change cannot quietly break them. */
describe('privacy', () => {
  test('no source file logs anything', () => {
    const logging = sources.filter((s) => /\bconsole\.(log|info|warn|error|debug)\b/.test(s.text)).map((s) => s.path);
    expect(logging).toEqual([]);
  });

  test('no network access exists, apart from reading a picked file on web', () => {
    const networked = sources.filter((s) => /\bXMLHttpRequest\b|\bWebSocket\b|\baxios\b/.test(s.text)).map((s) => s.path);
    expect(networked).toEqual([]);
    const fetching = sources.filter((s) => /\bfetch\(/.test(s.text)).map((s) => s.path.replace(/.*src\//, ''));
    expect(fetching).toEqual(['platform/files.ts']);
    expect(sources.find((s) => s.path.endsWith('platform/files.ts'))?.text).toContain('(await fetch(uri)).text()');
  });

  test('no remote addresses are hardcoded', () => {
    const remote = sources.filter((s) => /https?:\/\/(?!www\.w3\.org)/.test(s.text)).map((s) => s.path);
    expect(remote).toEqual([]);
  });

  test('no analytics, advertising or crash-reporting package is installed', () => {
    const banned = /analytics|sentry|bugsnag|crashlytics|firebase|amplitude|mixpanel|segment|admob|ads\b/i;
    expect(Object.keys(pkg.dependencies).filter((name) => banned.test(name))).toEqual([]);
  });
});
