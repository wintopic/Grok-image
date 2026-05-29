export async function onRequest(context) {
  const { request } = context;
  const origin = request.headers.get("Origin") || "";
  const requestUrl = new URL(request.url);
  const isSameOrigin = origin === requestUrl.origin;

  if (request.method === "OPTIONS") {
    const headers = new Headers();
    if (isSameOrigin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Max-Age", "600");
    }
    return new Response(null, { status: 204, headers });
  }

  const response = await context.next();
  const patched = new Response(response.body, response);

  if (isSameOrigin) {
    patched.headers.set("Access-Control-Allow-Origin", origin);
  }

  return patched;
}
