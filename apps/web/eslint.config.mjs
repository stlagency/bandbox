import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

// ESLint 9 flat config for the Next App Router app. Bridges the Next shareable
// config (`next/core-web-vitals` — the same rules `next build` lints with) into
// flat config via FlatCompat, so `eslint src` runs deterministically in CI
// (no interactive `next lint` setup prompt).
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals'),
];
