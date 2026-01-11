import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * ENV
 * - S3_BUCKET (required)
 * - AWS_REGION (optional) defaults to AWS_DEFAULT_REGION or ap-northeast-2
 * - S3_PREFIX (optional) defaults to "codex-v0/"
 * - URL_EXPIRES_IN (optional, seconds) defaults to 86400 (24h)
 */
const S3_BUCKET = process.env.S3_BUCKET;
if (!S3_BUCKET) {
  console.error("[mcp-s3-uploader] Missing env: S3_BUCKET");
  process.exit(1);
}

const AWS_REGION =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-northeast-2";
const DEFAULT_PREFIX = (process.env.S3_PREFIX ?? "codex-v0/").replace(
  /^\/*/,
  ""
);
const DEFAULT_EXPIRES_IN = Number.parseInt(
  process.env.URL_EXPIRES_IN ?? "86400",
  10
);

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function safePosixJoin(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, "/"))
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .join("/")
    .replace(/\/{2,}/g, "/");
}

async function uploadImageAndGetUrl(
  inputPath: string,
  opts: { prefix: string; expiresIn: number }
) {
  const absPath = path.resolve(inputPath);
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${absPath}`);

  const contentType = guessContentType(absPath);
  if (!contentType.startsWith("image/")) {
    throw new Error(`Not an image (by extension): ${absPath}`);
  }

  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  const ext = path.extname(absPath).toLowerCase() || ".bin";
  const id = crypto.randomUUID();
  const key = safePosixJoin(opts.prefix, y, m, d, `${id}${ext}`);

  const body = await fs.readFile(absPath);

  const s3 = new S3Client({ region: AWS_REGION });

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: opts.expiresIn }
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

// MCP server
const server = new McpServer({
  name: "mcp-s3-uploader",
  version: "0.1.0",
});

// Tool registration 스타일은 MCP TS 튜토리얼의 registerTool 패턴을 그대로 사용  [oai_citation:5‡Model Context Protocol](https://modelcontextprotocol.io/docs/develop/build-server)
server.registerTool(
  "upload_image",
  {
    description:
      "Upload a local image file to S3 and return a presigned GET URL (useful for v0-mcp imageUrl).",
    inputSchema: {
      path: z.string().describe("Local image path (.png/.jpg/.webp/.gif/.svg)"),
      keyPrefix: z
        .string()
        .optional()
        .describe("S3 key prefix (default: env S3_PREFIX or codex-v0/)"),
      expiresInSeconds: z
        .number()
        .int()
        .positive()
        .max(7 * 24 * 3600)
        .optional()
        .describe(
          "Presigned URL TTL in seconds (default: env URL_EXPIRES_IN or 86400)"
        ),
    },
  },
  async ({ path: p, keyPrefix, expiresInSeconds }) => {
    try {
      const result = await uploadImageAndGetUrl(p, {
        prefix: (keyPrefix ?? DEFAULT_PREFIX).replace(/^\/*/, ""),
        expiresIn: expiresInSeconds ?? DEFAULT_EXPIRES_IN,
      });

      // 첫 줄에 URL만 깔끔하게 두면, 다음 툴(v0)에 넘기기 쉬움
      return {
        content: [
          { type: "text", text: result.url },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `ERROR: ${msg}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout 금지(중요)  [oai_citation:6‡Model Context Protocol](https://modelcontextprotocol.io/docs/develop/build-server)
  console.error(
    `[mcp-s3-uploader] running on stdio (region=${AWS_REGION}, bucket=${S3_BUCKET})`
  );
}

main().catch((e) => {
  console.error("[mcp-s3-uploader] fatal:", e);
  process.exit(1);
});
