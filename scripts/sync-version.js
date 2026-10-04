#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Serialize an object as pretty JSON matching the repository convention
 * (2-space indent, trailing newline).
 * @param {unknown} value Value to serialize.
 * @returns {string} JSON text ending in a newline.
 */
function toJsonFile(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Produce the manifest content with its version synced to the plugin version.
 * Pure: does not touch the filesystem.
 * @param {Record<string, unknown>} manifestJson Parsed manifest.json contents.
 * @param {string} version Plugin version from package.json.
 * @returns {Record<string, unknown>} New manifest object with the synced version.
 */
function syncManifestVersion(manifestJson, version) {
  return { ...manifestJson, version };
}

/**
 * Produce the versions.json map with an entry for the given plugin version.
 * Existing entries are preserved; an existing entry for the same version is
 * overwritten (idempotent re-runs). Pure: does not touch the filesystem.
 * @param {Record<string, string>} versionsJson Parsed versions.json contents (may be empty).
 * @param {string} version Plugin version from package.json (the map key).
 * @param {string} minAppVersion minAppVersion from manifest.json (the map value).
 * @returns {Record<string, string>} New versions map including the entry.
 */
function syncVersionsEntry(versionsJson, version, minAppVersion) {
  return { ...versionsJson, [version]: minAppVersion };
}

/**
 * Sync package.json's version into manifest.json and record the
 * version -> minAppVersion pair in versions.json, writing both files.
 * @param {object} [options] Options.
 * @param {string} [options.rootDir] Repository root. Defaults to the parent of scripts/.
 * @returns {{ version: string, minAppVersion: string }} The synced version and its minAppVersion.
 */
function syncVersion({ rootDir = path.join(__dirname, '..') } = {}) {
  const packagePath = path.join(rootDir, 'package.json');
  const manifestPath = path.join(rootDir, 'manifest.json');
  const versionsPath = path.join(rootDir, 'versions.json');

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const version = packageJson.version;
  const syncedManifest = syncManifestVersion(manifestJson, version);
  const minAppVersion = syncedManifest.minAppVersion;

  const versionsJson = fs.existsSync(versionsPath)
    ? JSON.parse(fs.readFileSync(versionsPath, 'utf8'))
    : {};
  const syncedVersions = syncVersionsEntry(versionsJson, version, minAppVersion);

  fs.writeFileSync(manifestPath, toJsonFile(syncedManifest));
  fs.writeFileSync(versionsPath, toJsonFile(syncedVersions));

  return { version, minAppVersion };
}

module.exports = {
  toJsonFile,
  syncManifestVersion,
  syncVersionsEntry,
  syncVersion,
};

if (require.main === module) {
  const { version, minAppVersion } = syncVersion();
  console.log(`Synced version to ${version} (minAppVersion ${minAppVersion})`);
}
