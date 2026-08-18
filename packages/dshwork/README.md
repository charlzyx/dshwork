# @dshwork/dshwork

把 [dsh-plugin.work](https://dsh-plugin.work) 的「人工精选 / Pick By Human」带进 DeepSeek Harness——手挑的插件、工具和生态项目，每条附推荐理由，一键安装。

## 安装

```sh
dsh plugin --profile web add @dshwork/dshwork
```

重启 `dsh web`，在 **Settings → 精选** 查看。

## 结构

- **服务端** `src/index.ts`：`apply(ctx)` 注入 `webServer` / `loader`，挂 `/dshwork/picks.json`（数据代理）和 `/dshwork/install`（同源 POST，调用 `dsh plugin add`）
- **客户端** `src/client/`：注册 `settings.section` 区块，渲染精选列表（中英双语），底部链接 dsh-plugin.work

## 开发

```sh
pnpm install
pnpm -r --if-present run build
```

本地调试：`dsh plugin --profile web add /absolute/path/to/packages/dshwork`，重启 `dsh web` 看效果。

## 许可证

MIT
