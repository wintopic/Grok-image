import { errorResponse, jsonResponse, missingEnv, readJson, tokenMatches } from "../_lib/image-api.js";

export async function onRequestPost({ request, env }) {
  const missing = missingEnv(env);
  if (missing.length > 0) {
    return errorResponse("服务未配置，请先在 Cloudflare Pages 中设置环境变量。", 500, { missing });
  }

  const body = await readJson(request);
  if (!tokenMatches(body.accessToken, env.APP_ACCESS_TOKEN)) {
    return errorResponse("访问码不正确。", 401);
  }

  return jsonResponse({ ok: true, message: "验证成功" });
}
