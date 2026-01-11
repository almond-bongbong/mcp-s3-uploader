import 'dotenv/config';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';

/**
 * ENV
 * - S3_BUCKET (required)
 * - AWS_REGION (optional) defaults to AWS_DEFAULT_REGION or ap-northeast-2
 * - S3_PREFIX (optional) defaults to "codex-v0/"
 * - URL_EXPIRES_IN (optional, seconds) defaults to 86400 (24h)
 */
const S3_BUCKET = process.env.S3_BUCKET;
if (!S3_BUCKET) {
  console.error('[mcp-s3-uploader] Missing env: S3_BUCKET');
  process.exit(1);
}

const AWS_REGION =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-northeast-2';
const DEFAULT_PREFIX = (process.env.S3_PREFIX ?? 'codex-v0/').replace(
  /^\/*/,
  '',
);
const DEFAULT_EXPIRES_IN = Number.parseInt(
  process.env.URL_EXPIRES_IN ?? '86400',
  10,
);

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Utility */
function safePosixJoin(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'))
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .join('/')
    .replace(/\/{2,}/g, '/');
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

function createObjectKey(prefix: string, ext: string) {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  const id = crypto.randomUUID();
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  return safePosixJoin(prefix, y, m, d, `${id}${safeExt}`);
}

/** S3 upload helpers */
async function uploadImageAndGetUrl(
  inputPath: string,
  opts: { prefix: string; expiresIn: number },
) {
  const absPath = path.resolve(inputPath);
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${absPath}`);

  const contentType = guessContentType(absPath);
  if (!contentType.startsWith('image/')) {
    throw new Error(`Not an image (by extension): ${absPath}`);
  }

  const ext = path.extname(absPath).toLowerCase() || '.bin';
  const key = createObjectKey(opts.prefix, ext);

  const body = await fs.readFile(absPath);

  const s3 = new S3Client({ region: AWS_REGION });

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: opts.expiresIn },
  );

  return {
    url,
    bucket: S3_BUCKET,
    key,
    contentType,
    size: stat.size,
    region: AWS_REGION,
  };
}

/**
 * Clipboard helpers (macOS)
 * - Prefer pngpaste if installed (brew install pngpaste)
 * - Fallback to pbpaste -Prefer png (no install needed but less reliable)
 */
async function fileExists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function execFileBuffer(
  cmd: string,
  args: string[],
  maxBuffer = 30 * 1024 * 1024,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: 'buffer', maxBuffer },
      (error, stdout, stderr) => {
        if (error) {
          const stderrText = Buffer.isBuffer(stderr)
            ? stderr.toString('utf8')
            : String(stderr);
          reject(
            new Error(
              `Command failed: ${cmd} ${args.join(' ')}\n${stderrText || error.message}`,
            ),
          );
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout)));
      },
    );
  });
}

async function saveClipboardImageToTempPng(): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('upload_clipboard_image currently supports macOS only.');
  }

  const tmpPath = path.join(
    os.tmpdir(),
    `mcp-clipboard-${crypto.randomUUID()}.png`,
  );

  // 1) Try pngpaste (best)
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('pngpaste', [tmpPath], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (await fileExists(tmpPath)) {
      const st = await fs.stat(tmpPath);
      if (st.size > 0) return tmpPath;
    }
  } catch {
    // ignore; fallback to pbpaste below
  }

  // 2) Fallback: pbpaste -Prefer png (no brew install)
  try {
    const buf = await execFileBuffer('pbpaste', ['-Prefer', 'png']);
    if (!buf || buf.byteLength === 0) {
      throw new Error('pbpaste returned empty output.');
    }
    await fs.writeFile(tmpPath, buf);

    const st = await fs.stat(tmpPath);
    if (st.size > 0) return tmpPath;
    throw new Error('Failed to write clipboard PNG to temp file.');
  } catch {
    // cleanup
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }

    throw new Error(
      [
        'Failed to read clipboard image.',
        '- Ensure clipboard currently contains an IMAGE (e.g., take a screenshot, then copy)',
        '- Recommended: brew install pngpaste (more reliable)',
        '- Fallback used: pbpaste -Prefer png (may fail depending on clipboard format)',
      ].join('\n'),
    );
  }
}

/** MCP server */
const server = new McpServer({
  name: 'mcp-s3-uploader',
  version: '0.2.0',
});

/**
 * Tool 1) upload_image (path)
 */
server.registerTool(
  'upload_image',
  {
    description:
      'Upload a local image file to S3 and return a presigned GET URL (useful for v0-mcp imageUrl).',
    inputSchema: {
      path: z.string().describe('Local image path (.png/.jpg/.webp/.gif/.svg)'),
      keyPrefix: z
        .string()
        .optional()
        .describe('S3 key prefix (default: env S3_PREFIX or codex-v0/)'),
      expiresInSeconds: z
        .number()
        .int()
        .positive()
        .max(7 * 24 * 3600)
        .optional()
        .describe(
          'Presigned URL TTL in seconds (default: env URL_EXPIRES_IN or 86400)',
        ),
    },
  },
  async ({ path: p, keyPrefix, expiresInSeconds }) => {
    try {
      const result = await uploadImageAndGetUrl(p, {
        prefix: (keyPrefix ?? DEFAULT_PREFIX).replace(/^\/*/, ''),
        expiresIn: expiresInSeconds ?? DEFAULT_EXPIRES_IN,
      });

      return {
        content: [
          { type: 'text', text: result.url },
          { type: 'text', text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `ERROR: ${msg}` }] };
    }
  },
);

/**
 * Tool 2) upload_clipboard_image (clipboard -> temp file -> upload)
 */
server.registerTool(
  'upload_clipboard_image',
  {
    description:
      'Upload the current clipboard image (macOS) to S3 and return a presigned GET URL.',
    inputSchema: {
      keyPrefix: z
        .string()
        .optional()
        .describe('S3 key prefix (default: env S3_PREFIX or codex-v0/)'),
      expiresInSeconds: z
        .number()
        .int()
        .positive()
        .max(7 * 24 * 3600)
        .optional()
        .describe(
          'Presigned URL TTL in seconds (default: env URL_EXPIRES_IN or 86400)',
        ),
    },
  },
  async ({ keyPrefix, expiresInSeconds }) => {
    let tmpPath: string | null = null;

    try {
      tmpPath = await saveClipboardImageToTempPng();

      const result = await uploadImageAndGetUrl(tmpPath, {
        prefix: (keyPrefix ?? DEFAULT_PREFIX).replace(/^\/*/, ''),
        expiresIn: expiresInSeconds ?? DEFAULT_EXPIRES_IN,
      });

      return {
        content: [
          { type: 'text', text: result.url },
          { type: 'text', text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `ERROR: ${msg}` }] };
    } finally {
      if (tmpPath) {
        try {
          await fs.unlink(tmpPath);
        } catch {
          // ignore
        }
      }
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANT: Do not write logs to stdout (stdio protocol). Only stderr.
  console.error(
    `[mcp-s3-uploader] running on stdio (region=${AWS_REGION}, bucket=${S3_BUCKET}, prefix=${DEFAULT_PREFIX})`,
  );
}

main().catch((e) => {
  console.error('[mcp-s3-uploader] fatal:', e);
  process.exit(1);
});
