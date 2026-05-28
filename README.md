# Grok 图像生成 Pages

一个部署在 Cloudflare Pages 上的图像生成 Web 工具。浏览器只访问你的 Pages 站点，真实的上游 API URL 和 API Key 都放在 Cloudflare Pages 的环境变量/Secrets 中，不会下发到前端。

## 功能

- 使用 Cloudflare Pages 托管静态页面，使用 Pages Functions 提供 `/api/*` 服务端接口。
- 打开页面后必须输入访问码；访问码验证正确后弹窗自动关闭。
- 全中文界面，包含提示词输入、数量选择、结果预览、下载按钮和错误详情。
- Worker/Pages 函数端调用 OpenAI 兼容接口，默认模型为 `grok-imagine-image-lite`。
- 优先调用 `SPACEX_API_URL` 指向的 `/v1/chat/completions`；如果响应里没有图片，自动尝试同 base 的 `/v1/images/generations`。
- 支持解析 Markdown 图片链接、普通图片 URL、`data:image/...;base64,...`、`b64_json` 等常见返回格式。
- 如果上游返回图片 URL，Pages Function 会在服务端下载图片并转成 data URL 返回，避免浏览器直接接触上游链接和密钥。

## 项目结构

```text
.
├── functions/
│   ├── _lib/
│   │   └── image-api.js
│   └── api/
│       ├── auth.js
│       ├── config.js
│       └── generate.js
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
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
| `SPACEX_API_KEY` | 是 | 上游 API Key。只放在 Cloudflare Pages Secret 或本地 `.dev.vars`。 |
| `APP_ACCESS_TOKEN` | 是 | 页面访问码。用户验证通过后才能调用生成接口。 |
| `SPACEX_MODEL` | 否 | 上游模型名，默认 `grok-imagine-image-lite`。 |

页面显示“服务未配置”时，通常就是 `SPACEX_API_URL`、`SPACEX_API_KEY` 或 `APP_ACCESS_TOKEN` 没有在 Cloudflare Pages 的 Production 环境里配置。

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

启动本地 Pages：

```bash
npm run dev
```

打开 Wrangler 输出的本地地址，输入 `APP_ACCESS_TOKEN`、提示词和生成数量即可生成图片。

## 部署到 Cloudflare Pages

推荐使用 Cloudflare Dashboard 连接 GitHub 仓库。

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 创建 Pages 项目并连接 `wintopic/Grok-image` 仓库。
4. 框架预设选择 `None`。
5. Build command 可以留空；如果希望部署前检查，可填 `npm run check`。
6. Build output directory 填 `public`。
7. 保存并部署。

部署前或部署后，在 Pages 项目的 `Settings` -> `Environment variables` 中配置 Production 变量：

- `SPACEX_API_URL`
- `SPACEX_API_KEY`
- `APP_ACCESS_TOKEN`
- 可选：`SPACEX_MODEL`

建议把 `SPACEX_API_KEY` 和 `APP_ACCESS_TOKEN` 设置为 Secret。`SPACEX_API_URL` 也可以作为 Secret 保存。

也可以使用 Wrangler CLI 部署：

```bash
npm install
npx wrangler pages project create grok-image
npm run deploy
```

CLI 部署后仍需要在 Cloudflare Pages 项目里配置 Production 环境变量/Secrets。

## 使用方式

1. 打开部署后的 Pages 地址。
2. 在弹窗里输入访问码。
3. 验证成功后弹窗自动关闭。
4. 输入提示词。
5. 选择生成数量，最多 4 张。
6. 点击 `生成图片`。
7. 在作品区预览图片，并点击 `下载` 保存。

## API 行为

### GET `/api/config`

返回服务配置状态，不返回任何密钥或上游 URL。

```json
{
  "configured": true,
  "accessRequired": true,
  "model": "grok-imagine-image-lite",
  "missing": [],
  "message": "服务已就绪"
}
```

### POST `/api/auth`

验证访问码。

```json
{
  "accessToken": "your-access-code"
}
```

### POST `/api/generate`

生成图片。

```json
{
  "accessToken": "your-access-code",
  "prompt": "一台口袋大小的玻璃灯塔放在书桌上发光",
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
      "filename": "grok-image-0000000000000-01.jpg"
    }
  ],
  "model": "grok-imagine-image-lite",
  "source": "聊天接口"
}
```

## 安全说明

- 不要把真实 `.dev.vars` 提交到仓库。
- `SPACEX_API_KEY` 永远只在 Pages Function 环境变量中使用，前端不会收到。
- `APP_ACCESS_TOKEN` 是轻量访问控制，适合个人或小范围使用。公开流量较大的场景建议叠加 Cloudflare Access、WAF 或速率限制。
- 接口响应默认不缓存，并设置 `Cache-Control: no-store`。

## 常见问题

### 页面显示“服务未配置”

Cloudflare Pages 的 Production 环境缺少 `SPACEX_API_URL`、`SPACEX_API_KEY` 或 `APP_ACCESS_TOKEN`。检查 Pages 项目设置里的 Environment variables/Secrets。

### 弹窗提示“访问码不正确”

前端输入的访问码和 `APP_ACCESS_TOKEN` 不一致。

### 生成时报 `model_not_found`

上游服务当前不可用该模型。设置 `SPACEX_MODEL` 为上游 `/v1/models` 中可用的图像模型。

### 生成时报“接口返回中没有找到图片数据”

上游请求成功但响应里没有可解析的图片。确认当前模型支持图片生成，或检查上游是否返回了非标准字段。

## 开发脚本

```bash
npm run dev      # 本地运行 Cloudflare Pages
npm run check    # 语法检查和解析器测试
npm run deploy   # 通过 Wrangler 部署 Pages
```

## License

MIT
