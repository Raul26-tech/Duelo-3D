import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { participants, sides } from '../src/config/participants.ts';
const manifest: Record<string, { bytes: number; gitBlobSha: string }> = JSON.parse(
  readFileSync(new URL('./media-manifest.json', import.meta.url), 'utf8'),
);
test('os seis WebM configurados preservam os objetos Git da main de origem', () => {
  const configured = sides
    .flatMap((side) => Object.values(participants[side].videos))
    .sort();
  assert.equal(configured.length, 6);
  assert.equal(new Set(configured).size, 6);
  assert.deepEqual(
    readdirSync(new URL('../public/videos/', import.meta.url)).sort(),
    configured,
  );
  assert.deepEqual(
    Object.keys(manifest).sort(),
    configured.map((name) => `public/videos/${name}`).sort(),
  );
  for (const [path, expected] of Object.entries(manifest)) {
    const data = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(data.length, expected.bytes, path);
    assert.equal(data.subarray(0, 4).toString('hex'), '1a45dfa3', path);
    assert.equal(
      createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'),
      expected.gitBlobSha,
      path,
    );
  }
});
