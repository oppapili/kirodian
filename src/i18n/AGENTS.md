# i18n constraints

`src/i18n/` is the translation service. English is the default and the only
authoritative key source; every other locale mirrors it.

## Locale parity

- `locales/en.json` is the key authority. `TranslationKey` is derived from its
  shape (`typeof en`), so adding or renaming a UI string starts in `en.json`.
- Every other locale must stay structurally aligned with `en.json` — identical
  leaf-key set, no missing or extra keys. The locale parity test enforces this;
  a new key must land in all locales in the same change.
- `AVAILABLE_LOCALES`/`SUPPORTED_LOCALES`, the `Locale` union, and the
  `loadTranslation` switch are one set: adding a locale updates all of them plus
  a `locales/<code>.json` file.
- Unknown keys and non-default-locale misses fall back to English; keep that
  fallback rather than throwing.

## Bundling

- Non-English locales load lazily via `require('./locales/<code>.json')`; only
  `en` is imported eagerly. Production bundles every locale JSON through one
  compressed catalog (asserted by the build dependency-envelope test), so keep
  locale files importable JSON with no runtime-only dependencies.

## Branding

- `BRAND_NAME` is the single source of truth for the fork's user-visible name;
  do not reintroduce scattered brand string literals.
