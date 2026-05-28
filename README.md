# Grok Image Worker

一个部署在 Cloudflare Workers 上的图像生成 Web 工具。浏览器只访问你自己的 Worker，真实的上游 API URL 和 API Key 都放在 Cloudflare 部署环境变量里，不会下发到前端。

## 功能

- 使用 Cloudflare Workers + Static Assets 托管完整页面和服务端代理。
- 前端提供访问码、Prompt、生成数量、结果画廊和下载按钮。
- Worker 服务端调用 OpenAI 兼容接口，默认模型为 `grok-imagine-image-lite`。
- 优先调用 `SPACEX_API_URL` 指向的 `/v1/chat/completions`；如果响应里没有图片，自动尝试同 base 的 `/v1/images/generations`。
- 支持解析 Markdown 图片链接、普通图片 URL、`data:image/...;base64,...`、`b64_json` 等常见返回格式。
- 如果上游返回图片 URL，Worker 会在服务端下载图片并转成 data URL 返回，避免浏览器直接接触上游链接和密钥。
- 内置访问码 `APP_ACCESS_TOKEN`，避免公开部署后任何人都能直接消耗上游额度。

## 项目结构

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   └── index.js
├── test/
│   └── parser.test.mjs
├── .dev.vars.example
├── .gitignore
├── LICENSE
├── package.json
└── wrangler.jsonc
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SPACEX_API_URL` | 是 | 上游 chat completions URL，例如 `https://api.spacexapi.com/v1/chat/completions`。 |
| `SPACEX_API_KEY` | 是 | 上游 API Key。只放在 Cloudflare Secret 或本地 `.dev.vars`。 |
| `APP_ACCESS_TOKEN` | 是 | 页面访问码。用户在前端输入后才能调用 `/api/generate`。 |
| `SPACEX_MODEL` | 否 | 上游模型名，默认 `grok-imagine-image-lite`。 |

## 本地开发

环境要求：

- Node.js 18 或更高版本。
- 一个 Cloudflare 账号。

安装依赖：

```bash
npm install
```

本地调试需要在项目根目录放置 `.dev.vars`，内容格式参考 `.dev.vars.example`：

```bash
SPACEX_API_URL="https://api.spacexapi.com/v1/chat/completions"
SPACEX_API_KEY="replace-with-your-api-key"
APP_ACCESS_TOKEN="replace-with-a-private-access-code"
SPACEX_MODEL="grok-imagine-image-lite"
```

启动本地 Worker：

```bash
npm run dev
```

打开 Wrangler 输出的本地地址，输入 `APP_ACCESS_TOKEN`、Prompt 和生成数量即可生成图片。

## 部署到 Cloudflare

首次使用 Wrangler 时先登录：

```bash
npx wrangler login
```

设置部署环境变量。建议把 URL、Key、访问码都作为 Secret 写入：

```bash
npx wrangler secret put SPACEX_API_URL
npx wrangler secret put SPACEX_API_KEY
npx wrangler secret put APP_ACCESS_TOKEN
```

可选：如果需要覆盖默认模型，也可以设置：

```bash
npx wrangler secret put SPACEX_MODEL
```

部署：

```bash
npm run deploy
```

部署成功后，访问 Wrangler 输出的 workers.dev 地址或你绑定的自定义域名。

## 使用方式

1. 打开部署后的页面。
2. 输入访问码。
3. 输入 Prompt。
4. 选择生成数量，最多 4 张。
5. 点击 `Generate`。
6. 在结果区预览图片，并使用 `Download` 保存。

## API 行为

浏览器请求：

```http
POST /api/generate
Content-Type: application/json

{
  "accessToken": "your-access-code",
  "prompt": "A tiny red robot painting a sunrise",
  "count": 1
}
```

成功响应：

```json
{
  "images": [
    {
      "dataUrl": "data:image/jpeg;base64,...",
      "mediaType": "image/jpeg",
      "source": "chat.markdown",
      "filename": "generated-0000000000000-01.jpg"
    }
  ],
  "model": "grok-imagine-image-lite",
  "source": "chat/completions"
}
```

错误响应：

```json
{
  "error": "No image data was found in any API response.",
  "details": []
}
```

## 安全说明

- 不要把真实 `.dev.vars` 提交到仓库。
- `SPACEX_API_KEY` 永远只在 Worker 环境变量中使用，前端不会收到。
- `APP_ACCESS_TOKEN` 是轻量访问控制，适合个人或小范围使用。公开流量较大的场景建议叠加 Cloudflare Access、WAF 或速率限制。
- Worker 默认不缓存 API 响应，并给接口响应设置 `Cache-Control: no-store`。

## 常见问题

### 页面显示 `Needs Env`

部署环境缺少 `SPACEX_API_URL`、`SPACEX_API_KEY` 或 `APP_ACCESS_TOKEN`。检查 Cloudflare Dashboard 的 Worker Variables/Secrets，或重新执行 `wrangler secret put`。

### 生成时报 `Invalid access token`

前端输入的访问码和 `APP_ACCESS_TOKEN` 不一致。

### 生成时报 `model_not_found`

上游服务当前不可用该模型。设置 `SPACEX_MODEL` 为上游 `/v1/models` 中可用的图像模型。

### 生成时报 `No image data was found`

上游请求成功但响应里没有可解析的图片。确认当前模型支持图片生成，或检查上游是否返回了非标准字段。

## 开发脚本

```bash
npm run dev      # 本地运行 Worker
npm run check    # 语法检查和解析器测试
npm run deploy   # 部署到 Cloudflare
```

## License

MIT
