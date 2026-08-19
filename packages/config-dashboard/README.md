# @dshwork/config-dashboard

DeepSeek Harness 的 settings.yaml 可视化配置看板——**schema 驱动的通用配置编辑器**，覆盖宿主注册的每一个 settings namespace（含第三方插件），包括官方模型配置页没有暴露的全部字段（重试策略、超时、thinkingBudgets 等）。

设计文档见 [`docs/config-dashboard-design.md`](../../docs/config-dashboard-design.md)。

## 特性

- **全量覆盖**：通过 `connection.api.settings.describe()` 枚举运行时**每一个**注册的 namespace（官方 插件配置 页只渲染手写卡片，看板能看到全部）
- **schema 驱动表单**：object / dict / array / union / 标量递归渲染，无需任何手写表单
  - union（含纯 const 枚举，如 `transport`、`reasoning`）→ 分支选择器
  - 数组对象（如 llm-pi-ai 的 `models`）→ 每项可折叠 + 摘要标题 + 添加/删除
  - dict（如 `headers`、`modelOverrides`）→ 行编辑 + **表单 / JSON 双模式**（JSON/YAML 粘贴直填）
  - 布尔 → 开关；数字支持 `256K`/`1M` 后缀；必填字段标注；未设置显示占位而非伪造 0
- **继承/覆盖语义**：用户层与生效值分层展示，覆盖字段高亮点标记 + 一键重置（对齐官方「存在即覆盖」语义）
- **实时 YAML 预览**：每张卡片「表单 / YAML」切换，YAML 视图实时跟随草稿
- **保存管线**：浏览器 `validateDraft`（与宿主同校验器）预检 → 最小 diff 生成 `settings.mutate` ops → revision 冲突检测（冲突自动重载并保留草稿）
- **插件二级分类**：Tabs「全部 / 无自带界面 / 自带界面」——自带 UI 的插件默认折叠靠后；「无自带界面」是看板主战场，默认选中

## 安装

```sh
dsh plugin --profile web add @dshwork/config-dashboard
```

重启 `dsh web`，在 **Settings → 配置看板** 查看。

## 界面说明

- **Tabs**：全部 / 无自带界面 / 自带界面（默认「无自带界面」）。「自带界面」的判定来自 boot manifest 里带 client bundle 的条目 + 壳层 GUI 兜底名单
- **卡片**：每个 namespace 一张卡，点击展开/折叠。头部：名称 + 「需重启」标记 + 表单/YAML 切换 + chevron
- **表单**：字段 label 在上、控件在下，字段间分隔线（对齐官方 插件-插件配置 tab 样式）；覆盖字段高亮点 + 文字「重置」；必填标注「必填」
- **YAML/JSON 编辑**：卡片级「YAML」视图只读预览本段草稿；dict 字段级「JSON」模式可粘贴编辑（JSON 与 YAML 均支持，失焦或 ⌘+Enter 生效）

## 架构

- **服务端** `src/index.ts`：M1–M3 刻意保持最小——读写全部走浏览器侧 loopback settings RPC（与官方 Models 页同一套 `connection.api.settings`）。M4（原始 settings.yaml 视图/编辑）将注入 `webServer` 挂路由
- **客户端** `src/client/`：
  - `SettingsDashboard.tsx` — 看板主体（tabs、分组、卡片、保存管线）
  - `SchemaForm.tsx` — 递归 schema 渲染器（object/dict/array/union/const/标量 + 开关 + JSON 编辑器）
  - `draftOps.ts` — 草稿工具（diff 生成最小 ops、K/M 计数解析、空值默认）
  - `groups.ts` — 已知 namespace 的分类（未知归「其他」）
- **约束**：settings RPC 仅 loopback 可用（看板面向本机浏览器）；purity gate 下只依赖官方 model 层（schema-form）与 UI 原语（ui-primitives），表单渲染自研

## 开发

```sh
pnpm install
pnpm --filter @dshwork/config-dashboard run typecheck
pnpm --filter @dshwork/config-dashboard run build
```

本地热更调试：`dsh plugin --profile web add /absolute/path/to/packages/config-dashboard` 首次挂载后，改动 `src/client/` 由 `pnpm exec tsdown --watch` 重建，页面通过 HMR/刷新生效（无需重启 `dsh web`）。

## 已知限制

- settings RPC 仅 loopback（远程浏览器只读或不可用）
- namespace → 所属插件映射官方未暴露：内置插件用静态分类表，第三方按名称启发式，文档为限制而非正确性保证
- intersect/transform 等稀有类型以只读 JSON 展示；secret 字段仅展示状态（凭据走 credentials 只写存储，本版不编辑）
- M4 原始 YAML 视图（读 `documentPath` + 原子写）尚未实现

## 许可证

MIT
