# mcp-s3-uploader

An **MCP (Model Context Protocol) stdio server** that uploads **local images** or **clipboard images (macOS)** to **Amazon S3** and returns a **presigned GET URL**.

This is ideal for workflows where a downstream tool (e.g. **v0 MCP**) needs an **`imageUrl`**, but you only have:
- a local file path (`./design.png`)
- a screenshot copied to clipboard (no file path)

---

## ✨ What you get

- ✅ **`upload_image`** — Upload a local image by file path → returns presigned URL
- ✅ **`upload_clipboard_image` (macOS)** — Upload current clipboard image → returns presigned URL  
  - Uses `pngpaste` if available (recommended)
  - Falls back to `pbpaste -Prefer png` (no extra install, but less reliable)
- ✅ Built for **Codex CLI + MCP** pipelines
- ✅ Private S3 bucket supported (no need to make your bucket public)

---

## 🔁 Typical flow

```text
(Local path or Clipboard image)
        │
        ▼
mcp-s3-uploader (MCP server)
        │
        ▼
S3 PutObject (private)
        │
        ▼
Presigned GET URL (expires)
        │
        ▼
Pass URL to tools like v0 as imageUrl
```

---

## Requirements

- Node.js **>= 18**
- AWS credentials accessible by AWS SDK (recommended: `AWS_PROFILE`)
- An S3 bucket (private recommended)

### Optional (recommended for clipboard reliability on macOS)
```bash
brew install pngpaste
```

If you don’t install it, the server will try `pbpaste -Prefer png` as a fallback.

---

## 🚀 Quickstart (5 minutes)

### 1) Install dependencies
```bash
npm install
```

### 2) Create `.env`
Create a `.env` file in the project root:

```env
S3_BUCKET=your-bucket-name
AWS_REGION=ap-northeast-2
S3_PREFIX=codex-v0/
URL_EXPIRES_IN=86400
AWS_PROFILE=signin
```

**Env notes**
- `S3_BUCKET` (required): your S3 bucket name
- `AWS_REGION` (optional): default `ap-northeast-2`
- `S3_PREFIX` (optional): default `codex-v0/`
- `URL_EXPIRES_IN` (optional): URL TTL in seconds (default `86400` = 24h)
- `AWS_PROFILE` (optional): AWS CLI profile name

### 3) Build
```bash
npm run build
```

### 4) Test with MCP Inspector (recommended)
```bash
npx @modelcontextprotocol/inspector node ./build/index.js
```

Open the Inspector URL printed in terminal, then try:

#### Tool: `upload_image`
```json
{ "path": "/absolute/path/to/design.png" }
```

#### Tool: `upload_clipboard_image`
```json
{}
```

---

## 🧩 Use with Codex CLI (MCP)

### Register MCP server
From the project root:

```bash
ABS_PATH="$(pwd)/build/index.js"

codex mcp add s3Uploader   --env S3_BUCKET=your-bucket-name   --env AWS_REGION=ap-northeast-2   --env S3_PREFIX=codex-v0/   --env URL_EXPIRES_IN=86400   --env AWS_PROFILE=signin   -- node "$ABS_PATH"
```

Verify:
```bash
codex mcp list
```

### Use in Codex
**Local file**
> Upload `/path/to/design.png` using `upload_image` and return the URL only.

**Clipboard**
> Upload my clipboard image using `upload_clipboard_image` and return the URL only.

---

## 🔥 End-to-end: Codex + v0 MCP (Recommended)

Once you have:
- `s3Uploader` MCP server (this repo)
- `v0` MCP server

You can create a **Skill** to automatically:
1) upload local/clipboard image → 2) call v0 with `imageUrl`

### Skill folder
Create:
```bash
mkdir -p ~/.codex/skills/v0-s3-image-bridge
```

Create file:
`~/.codex/skills/v0-s3-image-bridge/SKILL.md`

```md
---
name: v0-s3-image-bridge
description: When the user asks to use v0 with an image (local path or clipboard), upload the image to S3 via MCP (upload_image / upload_clipboard_image) and then call v0_generate_from_image using the returned URL.
---

## Workflow
1) If user provides a local image path -> call upload_image({ path })
2) Else -> call upload_clipboard_image({})
3) Extract returned URL
4) Call v0_generate_from_image({ imageUrl: URL, prompt: user_instructions })
5) Return v0 output
```

Then in Codex, say:
> v0로 지금 클립보드 이미지 기반 UI 만들어줘. shadcn/ui + tailwind, 반응형.

---

## 🔧 Tool API

### `upload_image`
Uploads a local image file path to S3 and returns a presigned GET URL.

**Input**
- `path` (string, required)
- `keyPrefix` (string, optional)
- `expiresInSeconds` (number, optional)

**Output**
- First line: URL
- Second line: JSON metadata

### `upload_clipboard_image` (macOS)
Uploads the current clipboard image to S3 and returns a presigned GET URL.

**Input**
- `keyPrefix` (string, optional)
- `expiresInSeconds` (number, optional)

**Clipboard notes**
- Uses `pngpaste` if installed (recommended)
- Falls back to `pbpaste -Prefer png`

---

## 🔐 Recommended IAM Policy (minimal)

Restrict to a prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPutGetInPrefixOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/codex-v0/*"
    }
  ]
}
```

✅ You do **not** need to make the bucket public.

---

## 🧹 Optional: S3 Lifecycle cleanup

If you use this daily, objects will accumulate. Consider an S3 lifecycle rule to delete objects under your prefix after N days.

Example (concept):
- Prefix: `codex-v0/`
- Expiration: 30 days

---

## Troubleshooting

### `Missing env: S3_BUCKET`
- Ensure `.env` exists and is loaded, OR
- Pass env via `codex mcp add --env ...`

### Clipboard upload fails
- Ensure the clipboard contains an image (take a screenshot first)
- Install `pngpaste` for best reliability:
  ```bash
  brew install pngpaste
  ```

### S3 `AccessDenied`
- Ensure IAM allows `s3:PutObject` (and `s3:GetObject` for presigned URL usage)
- Double-check bucket name/region

### Presigned URL expired
- Increase `URL_EXPIRES_IN` (e.g. `172800` for 48 hours)

---

## Security Notes

- Do **not** commit AWS credentials.
- Prefer `AWS_PROFILE` or SSO-based workflows.
- Keep the bucket private; use presigned URLs.

---

## License

MIT
