# dshwork monorepo

charlzyx 的 DSH 插件仓库（pnpm workspace）。

| 包 | 说明 |
|----|------|
| `packages/dshwork` | [@dshwork/dshwork](https://www.npmjs.com/package/@dshwork/dshwork) — 人工精选 / Pick By Human |
| `packages/llm-provider-proxy` | [@dshwork/llm-provider-proxy](https://www.npmjs.com/package/@dshwork/llm-provider-proxy) — 按 provider 走 HTTP 代理 |
| `packages/config-dashboard` | [@dshwork/config-dashboard](./packages/config-dashboard) — settings.yaml 可视化配置看板（schema 驱动通用编辑器 + 插件二级分类） |

## 开发

```sh
pnpm install
pnpm -r --if-present run build
```

## 发布

1. 先改 `packages/*/package.json` 里的 `version`（要发的包才 bump），提交
2. 打 `v*` tag 触发 GitHub Actions 发布到公共 npm：

```sh
git tag v0.1.1 && git push origin v0.1.1
```
