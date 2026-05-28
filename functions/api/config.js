import { getModel, jsonResponse, missingEnv } from "../_lib/image-api.js";

export async function onRequestGet({ env }) {
  const missing = missingEnv(env);
  return jsonResponse({
    configured: missing.length === 0,
    accessRequired: true,
    model: getModel(env),
    missing,
    message: missing.length === 0 ? "服务已就绪" : "服务未配置",
  });
}
