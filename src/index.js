"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
var mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
var stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
var zod_1 = require("zod");
var promises_1 = require("node:fs/promises");
var node_path_1 = require("node:path");
var node_crypto_1 = require("node:crypto");
var client_s3_1 = require("@aws-sdk/client-s3");
var s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
/**
 * ENV
 * - S3_BUCKET (required)
 * - AWS_REGION (optional) defaults to AWS_DEFAULT_REGION or ap-northeast-2
 * - S3_PREFIX (optional) defaults to "codex-v0/"
 * - URL_EXPIRES_IN (optional, seconds) defaults to 86400 (24h)
 */
var S3_BUCKET = process.env.S3_BUCKET;
if (!S3_BUCKET) {
    console.error('[mcp-s3-uploader] Missing env: S3_BUCKET');
    process.exit(1);
}
var AWS_REGION = (_b = (_a = process.env.AWS_REGION) !== null && _a !== void 0 ? _a : process.env.AWS_DEFAULT_REGION) !== null && _b !== void 0 ? _b : 'ap-northeast-2';
var DEFAULT_PREFIX = ((_c = process.env.S3_PREFIX) !== null && _c !== void 0 ? _c : 'codex-v0/').replace(/^\/*/, '');
var DEFAULT_EXPIRES_IN = Number.parseInt((_d = process.env.URL_EXPIRES_IN) !== null && _d !== void 0 ? _d : '86400', 10);
function guessContentType(filePath) {
    var ext = node_path_1.default.extname(filePath).toLowerCase();
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
        default:
            return 'application/octet-stream';
    }
}
function safePosixJoin() {
    var parts = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        parts[_i] = arguments[_i];
    }
    return parts
        .filter(Boolean)
        .map(function (p) { return p.replace(/\\/g, '/'); })
        .map(function (p) { return p.replace(/^\/+|\/+$/g, ''); })
        .join('/')
        .replace(/\/{2,}/g, '/');
}
function uploadImageAndGetUrl(inputPath, opts) {
    return __awaiter(this, void 0, void 0, function () {
        var absPath, stat, contentType, now, y, m, d, ext, id, key, body, s3, url;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    absPath = node_path_1.default.resolve(inputPath);
                    return [4 /*yield*/, promises_1.default.stat(absPath)];
                case 1:
                    stat = _a.sent();
                    if (!stat.isFile())
                        throw new Error("Not a file: ".concat(absPath));
                    contentType = guessContentType(absPath);
                    if (!contentType.startsWith('image/')) {
                        throw new Error("Not an image (by extension): ".concat(absPath));
                    }
                    now = new Date();
                    y = String(now.getFullYear());
                    m = String(now.getMonth() + 1).padStart(2, '0');
                    d = String(now.getDate()).padStart(2, '0');
                    ext = node_path_1.default.extname(absPath).toLowerCase() || '.bin';
                    id = node_crypto_1.default.randomUUID();
                    key = safePosixJoin(opts.prefix, y, m, d, "".concat(id).concat(ext));
                    return [4 /*yield*/, promises_1.default.readFile(absPath)];
                case 2:
                    body = _a.sent();
                    s3 = new client_s3_1.S3Client({ region: AWS_REGION });
                    return [4 /*yield*/, s3.send(new client_s3_1.PutObjectCommand({
                            Bucket: S3_BUCKET,
                            Key: key,
                            Body: body,
                            ContentType: contentType,
                        }))];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, (0, s3_request_presigner_1.getSignedUrl)(s3, new client_s3_1.GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: opts.expiresIn })];
                case 4:
                    url = _a.sent();
                    return [2 /*return*/, {
                            url: url,
                            bucket: S3_BUCKET,
                            key: key,
                            contentType: contentType,
                            size: stat.size,
                            region: AWS_REGION,
                        }];
            }
        });
    });
}
// MCP server
var server = new mcp_js_1.McpServer({
    name: 'mcp-s3-uploader',
    version: '0.1.0',
});
// Tool registration 스타일은 MCP TS 튜토리얼의 registerTool 패턴을 그대로 사용  [oai_citation:5‡Model Context Protocol](https://modelcontextprotocol.io/docs/develop/build-server)
server.registerTool('upload_image', {
    description: 'Upload a local image file to S3 and return a presigned GET URL (useful for v0-mcp imageUrl).',
    inputSchema: {
        path: zod_1.z.string().describe('Local image path (.png/.jpg/.webp/.gif/.svg)'),
        keyPrefix: zod_1.z
            .string()
            .optional()
            .describe('S3 key prefix (default: env S3_PREFIX or codex-v0/)'),
        expiresInSeconds: zod_1.z
            .number()
            .int()
            .positive()
            .max(7 * 24 * 3600)
            .optional()
            .describe('Presigned URL TTL in seconds (default: env URL_EXPIRES_IN or 86400)'),
    },
}, function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
    var result, err_1, msg;
    var p = _b.path, keyPrefix = _b.keyPrefix, expiresInSeconds = _b.expiresInSeconds;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _c.trys.push([0, 2, , 3]);
                return [4 /*yield*/, uploadImageAndGetUrl(p, {
                        prefix: (keyPrefix !== null && keyPrefix !== void 0 ? keyPrefix : DEFAULT_PREFIX).replace(/^\/*/, ''),
                        expiresIn: expiresInSeconds !== null && expiresInSeconds !== void 0 ? expiresInSeconds : DEFAULT_EXPIRES_IN,
                    })];
            case 1:
                result = _c.sent();
                // 첫 줄에 URL만 깔끔하게 두면, 다음 툴(v0)에 넘기기 쉬움
                return [2 /*return*/, {
                        content: [
                            { type: 'text', text: result.url },
                            { type: 'text', text: JSON.stringify(result, null, 2) },
                        ],
                    }];
            case 2:
                err_1 = _c.sent();
                msg = err_1 instanceof Error ? err_1.message : String(err_1);
                return [2 /*return*/, { content: [{ type: 'text', text: "ERROR: ".concat(msg) }] }];
            case 3: return [2 /*return*/];
        }
    });
}); });
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var transport;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    transport = new stdio_js_1.StdioServerTransport();
                    return [4 /*yield*/, server.connect(transport)];
                case 1:
                    _a.sent();
                    // stdout 금지(중요)  [oai_citation:6‡Model Context Protocol](https://modelcontextprotocol.io/docs/develop/build-server)
                    console.error("[mcp-s3-uploader] running on stdio (region=".concat(AWS_REGION, ", bucket=").concat(S3_BUCKET, ")"));
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (e) {
    console.error('[mcp-s3-uploader] fatal:', e);
    process.exit(1);
});
