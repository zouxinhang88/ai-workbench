---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: b3ace11d5b9b6c99df0460e93cf411e5_fa6f0121a42c11f1bc17525400826444
    ReservedCode1: IR6C/Gt0P6OkZdljInl0pXnen3xAN0v+sb6rJlvgY6LVeTe5jjZFZPr7qTj3CkNn/SVZbZ+8wwCYkISjmP+dtKYs962yfpQYi+ZlF+2uZaa11D8RliQU7JJMrG1XvXtEYn3I2p7JlQDl65f956fgToOh1IrXTKLMbus29BA6UAZQBsJgCgG3KavKr+8=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: b3ace11d5b9b6c99df0460e93cf411e5_fa6f0121a42c11f1bc17525400826444
    ReservedCode2: IR6C/Gt0P6OkZdljInl0pXnen3xAN0v+sb6rJlvgY6LVeTe5jjZFZPr7qTj3CkNn/SVZbZ+8wwCYkISjmP+dtKYs962yfpQYi+ZlF+2uZaa11D8RliQU7JJMrG1XvXtEYn3I2p7JlQDl65f956fgToOh1IrXTKLMbus29BA6UAZQBsJgCgG3KavKr+8=
---

# AI 工作台

一个极简的本地 AI 聊天工作台，通过 OpenAI 兼容 API 连接本地模型服务（默认 LM Studio：`http://127.0.0.1:1234`），支持流式输出、多轮对话、自定义 System Prompt。纯静态页面，可直接部署到 Cloudflare Pages。

## 功能

- 流式（SSE）输出，打字机效果
- 多轮对话，自动携带上下文
- 自动拉取模型列表（`/v1/models`）
- 自定义 API 地址 / API Key / System Prompt（localStorage 持久化）
- 停止生成、新建对话

## 本地运行

方式一：直接用浏览器打开 `index.html`。

方式二：本地起静态服务：

```bash
cd ai-workbench
python3 -m http.server 8000
# 访问 http://localhost:8000
```

## 前置条件

1. 启动本地模型服务（LM Studio 等），确保端口 1234 可访问，且已加载模型。
2. 确认 CORS 已开启：LM Studio 的 Local Server 默认勾选 "Enable CORS"；若使用 Ollama（端口 11434），需设置 `OLLAMA_ORIGINS=*` 后重启。
3. 页面中 API 地址可按需修改（如换用 Ollama 则填 `http://127.0.0.1:11434`），点击"刷新"加载模型。

## 部署到 Cloudflare Pages

### 方式 A：拖拽上传（最快）

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → Create → Pages。
2. 选择 **Direct Upload**（直接上传）。
3. 项目名随意（如 `ai-workbench`），把 `index.html`、`style.css`、`app.js` 三个文件一起拖进上传框。
4. 点击 Deploy，完成后得到 `https://<project>.pages.dev` 访问地址。

### 方式 B：Git 集成

把三个文件提交到 Git 仓库，Pages 绑定仓库后自动构建部署（无构建命令、输出目录填 `/`）。

### 方式 C：Wrangler CLI

```bash
cd ai-workbench
npx wrangler pages deploy .
```

## 重要提醒

- **只有运行本地模型服务的那台电脑上打开页面，才能连上本地模型**。部署到 Pages 后，其他人访问你的公网地址，浏览器里请求的是他们自己的 `127.0.0.1`，无法访问你的电脑。
- **HTTPS 页面访问本地 HTTP 服务**：Chrome / Edge / Firefox 允许 HTTPS 页面请求 `localhost` / `127.0.0.1`（loopback 视为安全来源）；若个别浏览器拦截（Mixed Content），用 `npx wrangler pages dev` 在 `http://localhost:8788` 本地预览。
- 若希望部署后公网任何人可用，需要将 API 地址换成公网 OpenAI 兼容服务（OpenAI / DeepSeek / Moonshot 等），或在 Cloudflare 上使用 Workers AI。
*（内容由AI生成，仅供参考）*
