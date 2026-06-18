/**
 * Cloudflare R2 upload helper (S3-compatible) + shared env/tippecanoe utilities
 * for the tile build. Used by build.ts and geoBoundaries.ts.
 *
 * R2 is S3-compatible, so we talk to it with @aws-sdk/client-s3 pointed at the
 * account endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with
 * region 'auto'. Credentials + bucket come from R2_* env vars (PRD §8) — never
 * from source. R2 has no per-PUT charge that matters at our volume (one object
 * per source per night, well under the 1M Class-A ops/mo free allowance,
 * PRD §6 "Tiles").
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/** Resolved R2 connection config, read from process.env. */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface TileUploadResult {
  bucket: string;
  key: string;
  /** Bytes of the object PUT to R2. */
  bytes: number;
  contentType: string;
}

/** PMTiles archives are served as this content type so the CDN sets it correctly. */
export const PMTILES_CONTENT_TYPE = 'application/vnd.pmtiles';

/**
 * Read the four R2_* vars from the environment or throw with an actionable list
 * of what's missing. No connection detail is ever hardcoded (PRD §0.3, §8).
 */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  const accountId = env['R2_ACCOUNT_ID'];
  const accessKeyId = env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = env['R2_SECRET_ACCESS_KEY'];
  const bucket = env['R2_BUCKET'];

  const missing = [
    ['R2_ACCOUNT_ID', accountId],
    ['R2_ACCESS_KEY_ID', accessKeyId],
    ['R2_SECRET_ACCESS_KEY', secretAccessKey],
    ['R2_BUCKET', bucket],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Missing R2 env var(s): ${missing.join(', ')}. ` +
        'The tile build reads R2 credentials from the environment (no secrets in source). ' +
        'See .env.example for the R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET inventory.',
    );
  }

  // Non-null asserted: the `missing` check above guarantees all four are set.
  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
  };
}

/** The S3-compatible endpoint for an R2 account. */
export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** Build an S3Client configured for Cloudflare R2 (region 'auto'). */
export function makeR2Client(cfg: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: r2Endpoint(cfg.accountId),
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/**
 * Upload one local file to R2 as `key`. Reads the whole file into a Buffer (our
 * tile objects are tens of MB at most). Returns the bucket/key/size for logging.
 */
export async function uploadFileToR2(
  client: S3Client,
  cfg: R2Config,
  localPath: string,
  key: string,
  contentType: string = PMTILES_CONTENT_TYPE,
): Promise<TileUploadResult> {
  const body = await readFile(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { bucket: cfg.bucket, key, bytes: body.byteLength, contentType };
}

/**
 * Verify tippecanoe is installed and on PATH, failing LOUDLY with an actionable
 * message if not (PRD: "Guard the shell-out so a missing tippecanoe fails loudly").
 * Returns the version string on success.
 */
export function assertTippecanoeInstalled(binary = 'tippecanoe'): string {
  let res: SpawnSyncReturns<string>;
  try {
    res = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(tippecanoeMissingMessage(binary, err));
  }
  // ENOENT surfaces as res.error rather than a throw on most platforms.
  if (res.error || res.status === null) {
    throw new Error(tippecanoeMissingMessage(binary, res.error));
  }
  // tippecanoe prints its version to stderr.
  return (res.stderr || res.stdout || '').trim();
}

function tippecanoeMissingMessage(binary: string, cause: unknown): string {
  const detail = cause instanceof Error ? ` (${cause.message})` : '';
  return (
    `'${binary}' was not found on PATH${detail}. ` +
    'tippecanoe MUST be installed in the CI/runner image that runs the nightly tile build. ' +
    'Install it from https://github.com/felt/tippecanoe (or `brew install tippecanoe` locally).'
  );
}
