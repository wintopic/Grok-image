import {
  ApiFailure,
  clampCount,
  errorResponse,
  generateImages,
  jsonResponse,
  missingEnv,
  readJson,
  tokenMatches,
  validatePrompt,
} from "../_lib/image-api.js";

export async function onRequestPost({ request, env }) {
  const missing = missingEnv(env);
  if (missing.length > 0) {
    return errorResponse("服务未配置，请先在 Cloudflare Pages 中设置环境变量。", 500, { missing });
  }

  try {
    const body = await readJson(request);
    if (!tokenMatches(body.accessToken, env.APP_ACCESS_TOKEN)) {
      return errorResponse("访问码不正确。", 401);
    }

    const prompt = validatePrompt(body.prompt);
    const count = clampCount(body.count);
    const result = await generateImages(env, prompt, count);
    return jsonResponse(result);
  } catch (error) {
    const details = error instanceof ApiFailure ? error.publicDetails : undefined;
    return errorResponse(error.message || "生成失败。", error instanceof ApiFailure ? 400 : 502, details);
  }
}
