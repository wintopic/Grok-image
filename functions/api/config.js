import { getModel, jsonResponse, missingEnv } from "../_lib/image-api.js";

export async function onRequestGet({ env }) {
  const missing = missingEnv(env);
  const configured = missing.length === 0;
  return jsonResponse({
    configured,
    accessRequired: true,
    model: configured ? getModel(env) : undefined,
    message: configured ? "服务已就绪" : "服务未配置",
  });
}
