import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { toJsonFile, syncManifestVersion, syncVersionsEntry, syncVersion } = require('./sync-version.js');

test('toJsonFile uses 2-space indent and a trailing newline', () => {
  assert.equal(toJsonFile({ a: 1 }), '{\n  "a": 1\n}\n');
});

test('syncManifestVersion sets the version without mutating the input', () => {
  const manifest = { id: 'kirodian', version: '0.1.0', minAppVersion: '1.13.0' };
  const result = syncManifestVersion(manifest, '0.2.0');
  assert.equal(result.version, '0.2.0');
  assert.equal(result.minAppVersion, '1.13.0');
  assert.equal(manifest.version, '0.1.0');
});

test('syncVersionsEntry adds a new entry while preserving existing ones', () => {
  const existing = { '0.2.0': '1.13.0' };
  const result = syncVersionsEntry(existing, '0.3.0', '1.13.0');
  assert.deepEqual(result, { '0.2.0': '1.13.0', '0.3.0': '1.13.0' });
  assert.deepEqual(existing, { '0.2.0': '1.13.0' });
});

test('syncVersionsEntry overwrites the same version idempotently', () => {
  const existing = { '0.3.0': '1.12.0' };
  const result = syncVersionsEntry(existing, '0.3.0', '1.13.0');
  assert.deepEqual(result, { '0.3.0': '1.13.0' });
});

function makeRoot({ packageVersion, minAppVersion, versions }) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-version-'));
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    toJsonFile({ name: 'kirodian', version: packageVersion }),
  );
  fs.writeFileSync(
    path.join(rootDir, 'manifest.json'),
    toJsonFile({ id: 'kirodian', version: '0.0.0', minAppVersion }),
  );
  if (versions !== undefined) {
    fs.writeFileSync(path.join(rootDir, 'versions.json'), toJsonFile(versions));
  }
  return rootDir;
}

test('syncVersion syncs manifest and appends to an existing versions.json', () => {
  const rootDir = makeRoot({
    packageVersion: '0.3.0',
    minAppVersion: '1.13.0',
    versions: { '0.2.0': '1.13.0' },
  });
  try {
    const result = syncVersion({ rootDir });
    assert.deepEqual(result, { version: '0.3.0', minAppVersion: '1.13.0' });

    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, '0.3.0');

    const versionsText = fs.readFileSync(path.join(rootDir, 'versions.json'), 'utf8');
    assert.equal(versionsText, '{\n  "0.2.0": "1.13.0",\n  "0.3.0": "1.13.0"\n}\n');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('syncVersion creates versions.json when it is absent', () => {
  const rootDir = makeRoot({ packageVersion: '0.1.0', minAppVersion: '1.13.0' });
  try {
    syncVersion({ rootDir });
    const versions = JSON.parse(fs.readFileSync(path.join(rootDir, 'versions.json'), 'utf8'));
    assert.deepEqual(versions, { '0.1.0': '1.13.0' });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('syncVersion is idempotent across repeated runs', () => {
  const rootDir = makeRoot({
    packageVersion: '0.3.0',
    minAppVersion: '1.13.0',
    versions: { '0.2.0': '1.13.0' },
  });
  try {
    syncVersion({ rootDir });
    const first = fs.readFileSync(path.join(rootDir, 'versions.json'), 'utf8');
    syncVersion({ rootDir });
    const second = fs.readFileSync(path.join(rootDir, 'versions.json'), 'utf8');
    assert.equal(first, second);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
