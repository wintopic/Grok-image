export const DEFAULT_MODEL = "grok-imagine-image-lite";

const MAX_COUNT = 4;
const MAX_PROMPT_CHARS = 4000;
const REQUIRED_ENV = ["SPACEX_API_URL", "SPACEX_API_KEY", "APP_ACCESS_TOKEN"];

const DATA_URI_RE = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/g;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/g;
const URL_RE = /https?:\/\/[^\s)"'<>]+/g;
const BASE64_RE = /^[A-Za-z0-9+/=\s]{512,}$/;

export function missingEnv(env) {
  return REQUIRED_ENV.filter((name) => !String(env[name] || "").trim());
}

export function getModel(env) {
  return env.SPACEX_MODEL || DEFAULT_MODEL;
}

export function tokenMatches(received, expected) {
  const a = String(received || "");
  const b = String(expected || "");
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiFailure("请求体必须是 JSON。", [{ label: "请求解析", ok: false, status: 400 }]);
  }
}

export function jsonResponse(body, init = {}) {
  const status = typeof init === "number" ? init : init.status || 200;
  const headers = new Headers(typeof init === "number" ? undefined : init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of securityHeaders()) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(message, status = 500, details) {
  return jsonResponse({ error: message, details }, { status });
}

export function validatePrompt(prompt) {
  const value = String(prompt || "").trim();
  if (!value) {
    throw new ApiFailure("请输入提示词。", [{ label: "提示词", ok: false, status: 400 }]);
  }
  if (value.length > MAX_PROMPT_CHARS) {
    throw new ApiFailure(`提示词过长，请控制在 ${MAX_PROMPT_CHARS} 个字符以内。`, [
      { label: "提示词", ok: false, status: 400 },
    ]);
  }
  return value;
}

export function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_COUNT, parsed));
}

export async function generateImages(env, prompt, count) {
  const model = getModel(env);
  const attempts = [];

  const chatBody = chatPayload(model, prompt, count);
  const chat = await postJson(env.SPACEX_API_URL, env.SPACEX_API_KEY, chatBody);
  attempts.push(summarizeAttempt("聊天接口", chat));
  if (chat.ok) {
    const candidates = extractImageCandidates(chat.data, "chat");
    if (candidates.length > 0) {
      const images = await materializeCandidates(candidates.slice(0, count), env);
      return { images, model, source: "聊天接口" };
    }
  }

  const imageEndpoint = deriveImagesEndpoint(env.SPACEX_API_URL);
  for (const forceBase64 of [true, false]) {
    const label = forceBase64 ? "图片接口（base64）" : "图片接口";
    const imageBody = imagePayload(model, prompt, count, forceBase64);
    const response = await postJson(imageEndpoint, env.SPACEX_API_KEY, imageBody);
    attempts.push(summarizeAttempt(label, response));
    if (!response.ok) {
      continue;
    }

    const candidates = extractImageCandidates(response.data, "images");
    if (candidates.length > 0) {
      const images = await materializeCandidates(candidates.slice(0, count), env);
      return { images, model, source: label };
    }
  }

  throw new ApiFailure("接口返回中没有找到图片数据。", attempts);
}

export function deriveImagesEndpoint(chatEndpoint) {
  const clean = String(chatEndpoint || "").trim().replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) {
    return `${clean.slice(0, -"/chat/completions".length)}/images/generations`;
  }

  const url = new URL(clean);
  const parts = url.pathname.replace(/\/+$/, "").split("/");
  parts.pop();
  parts.push("images", "generations");
  url.pathname = parts.join("/");
  return url.toString();
}

export function chatPayload(model, prompt, count) {
  return {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an image generation endpoint. Generate the requested image. Return only direct image URLs, Markdown image links, data:image base64 URIs, or JSON containing b64_json/url image fields.",
      },
      {
        role: "user",
        content: `Create ${count} image(s):\n${prompt}`,
      },
    ],
  };
}

export function imagePayload(model, prompt, count, forceBase64 = true) {
  const payload = { model, prompt, n: count };
  if (forceBase64) {
    payload.response_format = "b64_json";
  }
  return payload;
}

async function postJson(url, apiKey, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "GrokImagePages/1.0",
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: parseJsonMaybe(text),
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: error.message || "网络请求失败",
    };
  }
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function extractImageCandidates(value, source = "response") {
  return dedupeCandidates(extractImageCandidatesInner(value, source));
}

function extractImageCandidatesInner(value, source) {
  const candidates = [];

  if (typeof value === "string") {
    return extractFromText(value, source);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      candidates.push(...extractImageCandidatesInner(item, `${source}[${index}]`));
    });
    return candidates;
  }

  if (!value || typeof value !== "object") {
    return candidates;
  }

  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const itemSource = `${source}.${key}`;

    if (["b64_json", "base64", "image_base64"].includes(lower) && typeof item === "string") {
      candidates.push({ source: itemSource, b64: normalizeBase64(item) });
      continue;
    }

    if (lower === "image" && typeof item === "string") {
      const extracted = extractFromText(item, itemSource);
      if (extracted.length > 0) {
        candidates.push(...extracted);
        continue;
      }
    }

    if (["url", "image_url"].includes(lower)) {
      if (typeof item === "string" && isProbablyImageUrl(item)) {
        candidates.push({ source: itemSource, url: item });
        continue;
      }
      if (item && typeof item === "object" && typeof item.url === "string" && isProbablyImageUrl(item.url)) {
        candidates.push({ source: `${itemSource}.url`, url: item.url });
        continue;
      }
    }

    candidates.push(...extractImageCandidatesInner(item, itemSource));
  }

  return candidates;
}

function extractFromText(text, source) {
  const candidates = [];
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = parseJsonMaybe(trimmed);
    if (parsed !== trimmed) {
      candidates.push(...extractImageCandidatesInner(parsed, `${source}.json`));
    }
  }

  for (const match of text.matchAll(DATA_URI_RE)) {
    candidates.push({ source: `${source}.data_uri`, b64: normalizeBase64(match[2]), mediaType: match[1] });
  }

  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = match[1].trim().replace(/^["']|["']$/g, "");
    if (isProbablyImageUrl(url)) {
      candidates.push({ source: `${source}.markdown`, url });
    }
  }

  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;]+$/g, "");
    if (isProbablyImageUrl(url)) {
      candidates.push({ source: `${source}.url`, url });
    }
  }

  const maybeB64 = maybeBase64Image(text);
  if (maybeB64) {
    candidates.push({ source: `${source}.base64`, b64: maybeB64 });
  }

  return candidates;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const key = `${candidate.url || ""}|${candidate.b64 ? normalizeBase64(candidate.b64).slice(0, 96) : ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

async function materializeCandidates(candidates, env) {
  const images = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const image = await candidateToDataUrl(candidate, env);
    images.push({
      dataUrl: image.dataUrl,
      mediaType: image.mediaType,
      source: candidate.source,
      filename: `grok-image-${Date.now()}-${String(index + 1).padStart(2, "0")}.${extensionForMime(image.mediaType)}`,
    });
  }
  return images;
}

async function candidateToDataUrl(candidate, env) {
  if (candidate.b64) {
    const b64 = normalizeBase64(candidate.b64);
    const mediaType = candidate.mediaType || inferMimeFromBase64(b64) || "image/png";
    return { dataUrl: `data:${mediaType};base64,${b64}`, mediaType };
  }

  if (candidate.url) {
    const response = await fetchImageUrl(candidate.url, env);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mediaType = response.headers.get("Content-Type")?.split(";")[0] || inferMimeFromBytes(bytes) || "image/jpeg";
    return {
      dataUrl: `data:${mediaType};base64,${bytesToBase64(bytes)}`,
      mediaType,
    };
  }

  throw new Error(`图片候选 ${candidate.source} 没有可用数据。`);
}

function isPrivateHostname(hostname) {
  if (
    hostname === "localhost" ||
    hostname === "" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  const parts = hostname.split(".");
  if (parts.every((p) => /^\d+$/.test(p)) && parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      return true;
    }
  }

  if (hostname.startsWith("[")) {
    const inner = hostname.slice(1, -1).toLowerCase();
    if (
      inner === "::1" ||
      inner.startsWith("fe80:") ||
      inner.startsWith("fc00:") ||
      inner.startsWith("fd") ||
      inner === "::"
    ) {
      return true;
    }
  }

  return false;
}

function assertSafeUrl(raw) {
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked fetch: disallowed protocol ${parsed.protocol}`);
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("Blocked fetch: private/internal address");
  }
  return parsed.href;
}

async function fetchImageUrl(url, env) {
  const safeUrl = assertSafeUrl(url);
  let response = await fetch(safeUrl, {
    headers: { "User-Agent": "GrokImagePages/1.0" },
  });

  if (response.status === 401 || response.status === 403) {
    response = await fetch(safeUrl, {
      headers: {
        Authorization: `Bearer ${env.SPACEX_API_KEY}`,
        "User-Agent": "GrokImagePages/1.0",
      },
    });
  }

  if (!response.ok) {
    throw new Error(`下载生成图片失败，HTTP ${response.status}`);
  }

  return response;
}

function isProbablyImageUrl(value) {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    const path = url.pathname.toLowerCase();
    return (
      [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].some((suffix) => path.endsWith(suffix)) ||
      path.includes("image") ||
      path.includes("img") ||
      path.includes("generations")
    );
  } catch {
    return false;
  }
}

function normalizeBase64(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function maybeBase64Image(value) {
  const candidate = normalizeBase64(value);
  if (!BASE64_RE.test(candidate)) {
    return null;
  }
  return inferMimeFromBase64(candidate) ? candidate : null;
}

function inferMimeFromBase64(value) {
  try {
    const preview = base64ToBytes(value.slice(0, 128));
    return inferMimeFromBytes(preview);
  } catch {
    return null;
  }
}

function base64ToBytes(value) {
  const clean = normalizeBase64(value);
  const padded = clean.padEnd(Math.ceil(clean.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function inferMimeFromBytes(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  return null;
}

function extensionForMime(mediaType) {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

function summarizeAttempt(label, response) {
  return {
    label,
    ok: response.ok,
    status: response.status,
    responseType: typeof response.data,
    preview: sanitizePreview(response.text),
  };
}

function sanitizePreview(text) {
  if (!text) {
    return "";
  }
  return String(text).replace(/[A-Za-z0-9+/]{300,}={0,2}/g, "[base64 omitted]").slice(0, 1200);
}

function securityHeaders() {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
}

export class ApiFailure extends Error {
  constructor(message, publicDetails) {
    super(message);
    this.publicDetails = publicDetails;
  }
}
