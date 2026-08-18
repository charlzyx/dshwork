# @dshwork/llm-provider-proxy

DeepSeek Harness (DSH) 通用**按 provider 走代理**插件：一个代理地址 + 一个 provider 列表，列表里的 provider 的模型请求（和认证/刷新请求）全部走该代理。

## 配置（settings.yaml，热生效）

```yaml
dsh-provider-proxy:
  proxy: http://127.0.0.1:7897      # 一个 HTTP 代理（Clash/ClashX/公司代理均可）
  providers:                         # 哪些 provider 走这个代理
    - openai-codex
    - anthropic
```

## 安装（零手写挂载）

本包是 **bundle**（`dsh.bundle.patch`）：`dsh plugin add` 会自动把它加进 profile 的
`dsh.profile.bundles`，**无需手改 cordis.patch.yml**。

```bash
dsh plugin --profile web add @dshwork/llm-provider-proxy
```

重启 `dsh web` 生效。

## 工作原理

- 插件安装一个全局 `fetch` 包装：每个请求按 host 判断属于哪个 provider，命中配置列表则经代理隧道发出（包内自实现零依赖 CONNECT 隧道），否则原样放行
- host 归属自动解析：
  - 内置表：`openai-codex` → chatgpt.com / auth.openai.com；`deepseek-official` → api.deepseek.com；anthropic / openai / openrouter / google 等常见 provider
  - 自建网关：从 `llm-pi-ai` / `llm-deepseek` 设置段的 `baseURL` 读取 host（比如你的 acmos 路由）
- **回环地址（127.0.0.1 / localhost）永不代理**，不会劫持本机内部流量
- 代理需要用户名密码时：`proxy: http://user:pass@host:port`

## 依赖

零运行时依赖（CONNECT 隧道为 node 内置模块实现）。
- `@deepseek-ai/dsh-settings` / `schemastery` / `cordis`：插件接口（peer，宿主提供）

## 验证记录

- 单元：CONNECT 隧道、host → provider 路由、回环放行、凭据代理头
- 端到端：`openai-codex` 经 127.0.0.1:7897 代理正常出网（chatgpt.com 可达）


## 许可证

MIT
