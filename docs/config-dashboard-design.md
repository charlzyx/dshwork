# @dshwork/config-dashboard 设计文档

> 状态：设计稿 v0.1（2026-08-19，基于官方 `@deepseek-ai/dsh@0.1.x` 源码核实）
> 落点：`dshwork` monorepo 新包 `packages/config-dashboard`（npm 名 `@dshwork/config-dashboard`）
> MVP：**可视化 settings 配置看板**；二期：**插件二级分类浏览器 + 配置指南**

## 1. 背景与目标

`settings.yaml`（`$DSH_HOME/settings.yaml`，默认 `~/.dsh/settings.yaml`）是 DSH 用户配置层，按 namespace 分节、热重载。当前只有官方手写卡片能编辑极少数 namespace（Models 页的 `llm-deepseek`/`llm-pi-ai`、插件配置 tab 的 `bash`/`agent-loop`/`web-search-deepseek`），第三方插件注册的 namespace（如 `dsh-provider-proxy`、`dsh-vision-sidecar`、`dsh-better-sidebar`、`pet`、`skin-background`、`remote-web-ui`）在 UI 里**完全不可见**，只能手改 YAML。

本包目标：

1. **通用 schema 驱动设置编辑器**：把 `ctx.settings.describe()` 序列化出的每一个已注册 namespace 渲染成可编辑表单，用户覆盖字段可标注、可重置，保存走带 revision 栅栏的写入管线。
2. **插件二级分类浏览器**：以 VS Code 设置页为参照（左侧分组树 + 顶部搜索 + 右侧条目），先把官方内置 185 个插件做二级分类，再接入市场数据源；每个条目带安装命令、源码/许可链接与「如何配置」入口。

## 2. 为什么可行（已核实的事实）

- 官方文档（[User Settings 子系统](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/settings)）明说 `describe()` 的 schemastery `toJSON()` 信封「drives schema-rendered forms」，`base`/`user` 分层可标注覆盖字段，`redactSecrets` 提供只写密钥槽——**schema 驱动表单的底层机制官方已备好，只缺通用渲染器**。
- `@deepseek-ai/dsh-client-schema-form` 已提供模型层：`rehydrateSchema`（把信封还原成活校验器，与宿主校验同源）、`setPath`/`deletePath`/`hasPath`（存在性语义的覆盖标记）、`nodeAtPath`（provider 目录 schema 探测）、`validateDraft`。README 原话：「没有通用渲染器——消费方在这些辅助函数上构建功能专用表单」——通用渲染器是官方刻意留给生态的空白。
- 官方 Models 页就是参照实现：客户端注入 `slots/locale/connection/remote`，用 `connection.api.settings.describe({})` 拉全量/按 ref 的 descriptor，写入走 `settings.mutate` 路径 op + revision 栅栏。
- 第三方客户端插件模式已验证：`@dshwork/dshwork` 的 tsdown lazy-CJS bundle（`__ModuleLoader__.load` banner）可直接复制；`settings.section`（顶层导航）与 `settings.plugins.tab`（官方「插件」分区内 tab）两个 slot 都可注册。
- settings RPC 仅 loopback：看板只对本机浏览器（如 `http://127.0.0.1:3080`）生效，符合本包定位。

## 3. 包结构

```
packages/config-dashboard/
├── package.json            # name: @dshwork/config-dashboard
├── tsconfig.json / tsconfig.client.json
├── tsdown.config.ts        # 复制 dshwork 的 lazy-CJS client bundle 配置
├── src/
│   ├── index.ts            # host 插件：注入 settings/webServer/loader
│   ├── routes.ts           # host HTTP 路由：YAML 原始视图、市场数据代理
│   ├── taxonomy.ts         # 官方内置插件二级分类静态数据（见附录）
│   └── client/
│       ├── index.tsx       # 注册 settings.plugins.tab（配置）与 settings.section（插件浏览器）
│       ├── SettingsDashboard.tsx   # MVP：全量 namespace 表单看板
│       ├── SchemaForm.tsx          # 通用表单渲染器（核心资产，自研）
│       ├── PluginBrowser.tsx       # 二期：二级分类浏览器
│       └── locales.ts
```

依赖：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-settings`（host 侧；peer）、`@deepseek-ai/dsh-client-schema-form`（client 侧，noExternal 打进 bundle）、`react`/`react/jsx-runtime`/`@deepseek-ai/dsh-client-ui-primitives`（external）。

## 4. MVP：可视化配置看板

### 4.1 数据流

```
host: ctx.settings.describe({ redactSecrets: true })
  → 每 namespace: { schemaEnvelope(schema.toJSON()), value, base, user, revision, applies }
  → browser: connection.api.settings.describe({})   // 官方 models 页同款入口
  → rehydrateSchema(new Schema(envelope))           // @deepseek-ai/dsh-client-schema-form
  → SchemaForm 按信封渲染控件（value 填充，user 层字段标「已覆盖」）
  → 编辑 draft：setPath / deletePath（删除=逐字段 reset 回 base）
  → validateDraft(schema, draft)                    // 写入前本地校验
  → 保存：api.settings.mutate({ ns, ops: [{op:'set'|'unset', path}], expectedRevision })
  → 被拒（SETTINGS_CONFLICT / settings-rejected）→ 回读重载，保留草稿
```

### 4.2 通用表单渲染器 SchemaForm（核心自研资产）

- 输入：schemastery `toJSON()` 信封 + 当前 draft + `base`/`user` 分层。
- 控件映射（对齐 schemastery 类型系统）：
  - `object` → 分组卡片（`nodeAtPath` 解析子字段）
  - `string` + `meta.role==='secret'` → 只写密码框（来自 `secrets: [{path, set}]`，绝不回传值）
  - `string` + `enum` → 下拉；`string` → 文本框；`boolean` → 开关；`number` → 数字框（含 K/M 后缀解析，参照 models 页）
  - `array` → 可增删的行列表（整段 replace-by-value，参照 `llm-pi-ai.models` 的交互）
  - `dict`/`inner` → 键值对列表（provider 目录类，如 `llm-pi-ai.providers`）
- 每字段三态：继承（base/schema 默认）｜已覆盖（user 层存在）→ 可一键 reset（`deletePath`）｜草稿（未保存）。
- `applies: 'restart'` 的 namespace 顶部提示「需重启生效」。

### 4.3 namespace 列表页（SettingsDashboard）

- 官方「插件」分区新增 tab（`settings.plugins.tab`，id `config-dashboard`），与「插件列表」「插件配置」并排；同时保留独立 `settings.section` 导航入口（与 dshwork/dshmarket 同模式）。
- 顶部搜索（namespace 名 + 字段名 + schema 描述），左侧按「已配置 / 全部」筛选。
- 每个 namespace 一张卡片：名称、owner 说明（`applies`）、覆盖字段计数、展开后渲染 SchemaForm。
- 空 namespace（`llm-deepseek: {}`）显示「当前无配置（继承组合层）」+ 可直接添加字段。

### 4.4 原始 YAML 视图

- host 路由 `GET/POST /dshwork-config/raw`：读/写 `ctx.settings.documentPath`（settings-file 提供，即 `~/.dsh/settings.yaml`），写入用 `@deepseek-ai/dsh-atomic-write`（原子替换 + 锁）。
- 只读 YAML 预览（语法高亮）与「用编辑器打开」（`prepareDocument()` 返回路径）两种模式；表单保存与 YAML 编辑互为镜像，靠 `settings/document-updated` 事件 + revision 同步，避免双写冲突。
- 也提供 `dsh --dump-config` 风格的「生效配置」预览（组合 base + 用户层合并结果）。

## 5. 二期：插件二级分类浏览器

### 5.1 数据源

| 数据源 | 内容 | 用途 |
|---|---|---|
| 官方内置（Loader/`dsh-*` 包） | 185 个 `@deepseek-ai/dsh-*` | 内置插件分类 + 已装状态（与 `pluginInventory.list()` 对照） |
| [dsh-plugin.work](https://dsh-plugin.work/llms.txt) | 1,886 插件 / 8 大类，SSR explore 页 + llms.txt + snapshot API | 市场浏览（host 代理抓取） |
| [awesome-dsh-plugin.com/plugins.json](https://awesome-dsh-plugin.com/plugins.json) | 1,424 插件 / 20 类，单 JSON（中英描述、install、stars） | 备选/合并数据源（dshmarket 已在用） |

注：dsh-plugin.work 分类正在重构（可能参考 dshmarket），故分类树先以官方内置 185 包为准（见附录），市场数据源的分类做归一化映射，改动只影响数据层。

### 5.2 UX（对齐 VS Code 设置页）

- 左侧：二级分类树（8 大组 × 26 子类，带计数），可折叠；顶部搜索跨名称/描述/分类过滤。
- 右侧：条目列表。每条：包名/短名、一句话描述、分类面包屑、**已安装徽标**（对照 loader 清单）、stars/license、安装命令（`dsh plugin --profile web add ...`，一键复制）、源码链接。
- 「如何配置」：已安装插件 → 展开其 settings namespace 的 SchemaForm（复用 4.2，与配置看板同源）；未安装 → README/源码链接 + 若市场条目带 config 元数据则直接展示。
- 内置 185 包与第三方市场插件同表：内置默认标记「内置」，第三方标记「社区」。

### 5.4 第三方插件「自带 GUI / 纯 host」的共存与检测

第三方插件分两类，看板对它们的价值不同：

- **自带 GUI 的插件**（有 `dsh.client` 客户端半侧，如 dshwork 的「精选」、dshmarket 的「市场」、dsh-better-sidebar）：它们自己贡献 Settings 区块/侧栏。若其 namespace 也有手写卡片（官方 `settings.plugin.item` 槽按 namespace 认领），我们的通用表单与卡片**并存**——通用表单覆盖更全（手写卡片是「用 mockup 布局换 schema 通用覆盖」，见官方 models 编辑器取舍说明），UI 上加「该 namespace 另有专用卡片」提示即可。
- **纯 host 插件**（无客户端半侧，如 `@dshwork/llm-provider-proxy` 注册 `dsh-provider-proxy` namespace、`@didi/dsh-vision-sidecar`）：它们**没有任何自带配置界面**，settings.yaml 是唯一配置入口——**这正是看板的核心用户群**。

「有无自带 GUI」的检测信号（客户端可拿到的）：

1. `window.__DSH_BOOT__.entries`（启动清单）列出所有带客户端 bundle 的包 → 有 GUI；
2. 官方「插件配置」tab 的 namespace 认领交集（`settings.plugin.item` 槽）→ 有专用卡片；
3. 其余 namespace 且 owner 无客户端条目 → 「仅在此可配置」。

看板据此提供**「仅此可配（纯 host 插件）」快捷筛选**，让用户一眼找到那些官方 UI 碰不到、只能手改 YAML 的段（`dsh-provider-proxy`、`dsh-vision-sidecar`、`pet`、`skin-background`…）。namespace→owner 映射官方不暴露，对已知内置包用静态表，对第三方用名称启发式 + 包 README 链接，作为已知限制（见 §6）。

### 5.3 分类数据模型（静态，放 `src/taxonomy.ts`）

```ts
interface PluginTaxon { group: string; subgroup: string }   // zh/en 双语 label
// packageName -> taxon；官方 185 包全覆盖（脚本校验，见附录）
```

运行时与 `describe()` 结果交叉：内置包实际注册了哪些 namespace 以运行时的 `describe()` 键为准（静态表只给分类，不给配置事实），避免与真实宿主漂移。

## 6. 约束与风险

| 约束 | 说明 | 对策 |
|---|---|---|
| settings RPC loopback-only | 远程浏览器无持久化设置 | 定位即本机看板，接受 |
| **client 半侧仅 web profile 生效** | `dsh-client-modules` 扫描 loader 条目时按 `platform === 'web'` 过滤（`dsh.client.platform`），非 web 平台的包、以及非 web profile 中挂载的包，其客户端条目被静默跳过（无提示消息）；host 半侧在任何 profile 都运行 | 本包声明 `dsh.client.platform: 'web'`；M1–M3 纯客户端功能仅在 `dsh web` 可见，headless 等 profile 不受影响（本包 host 半侧 M4 前为空） |
| 客户端 bundle 纯净度门禁 | 禁止以值导入官方卡片外观/表单模型 | SchemaForm 完全自研；只 import `dsh-client-schema-form` 模型层（官方 models 页同款用法） |
| `rehydrateSchema` 执行信封 | 信封来自同一受信任宿主才安全 | 只对 `connection.api`（loopback）返回的信封调用 |
| 官方未暴露「namespace → owner 插件」映射 | 插件浏览器无法自动知道谁注册了谁 | 内置包用静态映射；第三方用名称启发式 + README 链接，作为已知限制 |
| 分类数据维护 | 官方包随版本增删 | taxonomy 表脚本化生成 + CI 校验覆盖（185/185） |

## 7. 里程碑

- **M0 脚手架**：包结构 + tsdown client bundle + 空 tab/导航注册 + host 路由骨架
- **M1 列表**：`describe()` 全量拉取、namespace 卡片列表、搜索
- **M2 表单**：SchemaForm 通用渲染器（object/string/boolean/number/enum/array/dict + secret）
- **M3 写入**：draft → validateDraft → mutate + revision 管线、冲突回读、reset
- **M4 YAML**：原始视图/编辑 + `document-updated` 双向同步
- **M5 分类浏览器**：内置 185 包分类树 + 已装徽标 + 配置入口
- **M6 市场接入**：dsh-plugin.work / awesome 数据源归一化

## 8. 实现状态（v0.1.0）

已发布为 `@dshwork/config-dashboard` v0.1.0（2025-08，npmjs，public）。以下为 M0–M3 落地情况与 M4+ 的偏差记录。

| 设计 | 实现状态 |
|---|---|
| 4.1 数据流（describe → rehydrateSchema → 草稿 → validateDraft → diffOps → mutate + revision） | ✅ 完整落地；冲突路径保留草稿 + 提示（见 8.1 修复） |
| 4.2 SchemaForm 通用渲染器 | ✅ object / dict / array / union / const / 标量全覆盖；**超出原设计**：union 分支选择器（含纯 const 枚举）、数组对象逐项折叠 + 摘要、dict「表单/JSON」双模式、布尔开关、必填标注、未设置占位（不再伪造 0） |
| 4.3 namespace 列表页 | ✅ 落地为**卡片手风琴列表**（非左树右编辑器）：Tabs 全部/无自带界面/自带界面（默认后者）、分组标题 + 计数、卡片展开折叠、表单/YAML 切换、保存/取消右对齐页脚 |
| 5.4 自带 GUI 检测 | ✅ boot manifest `entries[].url`（client bundle）+ 壳层 GUI 兜底名单；自带 UI 默认折叠 + 组内排序靠后 |
| 4.4 原始 YAML 视图（M4） | ⬜ 未实现（host 半侧仍为空 `apply`）；卡片级 YAML 为只读草稿预览 |
| 5.1/5.2/5.3 分类浏览器与市场（M5/M6） | ⬜ 未实现；当前分组用 `groups.ts` 静态 4 桶（模型与网络/界面与体验/执行与安全/其他），非 185 包 taxonomy |
| UI 风格 | 卡片/表单对齐官方 插件-插件配置 tab（At1oFq/YyYd_a CSS 同参数：字段分隔线、34px 输入、bg-layer-3 卡、catalogHeading 分组） |

### 8.1 发布前 review 修复记录

- **冲突提示被冲掉（真 bug）**：编辑器 auto-open effect 原依赖 `state.namespaces`，`load()` 刷新后 effect 重开编辑器，把 conflictHint 和保留草稿清掉 → 改为仅 `expanded` 变化时打开（namespaces 走 ref 读取）
- 数字字段 `typeof value === 'number' ? value : 0` 把「未定义」伪造为 0（thinkingBudgets 四个字段显示 0 的根因）→ 未定义显示空输入 + 「未设置」占位，清空 = 移除覆盖
- `Input` 组件双层框：primitives Input 是 wrapper span + 内层 input，叠样式导致双边框 → 全部换原生 `<input>` 单层样式（对齐官方 input 参数）
- union 纯 const 成员三分支 bug（标签显示「const」/ 分支匹配失败 / 切换写入空对象）→ 修复
- 文案清理（16+ 个未用 locale key）、token 常量 `T` 与类型 `T` 同名 → 重命名 `TOKENS`

### 8.2 后续待办

- M4 原始 YAML 视图（host 路由 + `documentPath` + 原子写 + self-restart 端点）
- M5 分类浏览器（taxonomy 表驱动 + 已装徽标 + 配置入口）
- 数组内对象「添加」预填 provider 级默认值（如 llm-pi-ai 新模型带 `defaultContextWindow/defaultMaxTokens`）
- 性能：`rootNodeOf`（rehydrateSchema）在渲染热路径反复执行 → 按 namespace memo

## 附录：官方内置插件二级分类（185 包 / 8 组 / 26 子类，脚本校验 185/185 覆盖）

| 一级 | 二级 | 包 |
|---|---|---|
| 模型与推理 | LLM 路由与适配 | dsh-agent-default-model、dsh-llm、dsh-llm-deepseek、dsh-llm-pi-ai、dsh-llm-retry、dsh-token-meter |
| 模型与推理 | 搜索与联网 | dsh-tool-web、dsh-web、dsh-web-search-deepseek |
| 模型与推理 | 网关与 API | dsh-api-gateway、dsh-api-remotes、dsh-host-apiproxy、dsh-typert-loader、dsh-typert-protocol、dsh-typert-registry |
| Agent 与编排 | Agent 循环与提示词 | dsh-agent、dsh-agent-instructions、dsh-agent-loop、dsh-agent-presets、dsh-agent-tool-presentation、dsh-persona、dsh-plan-mode、dsh-system-prompt |
| Agent 与编排 | 子代理 | dsh-subagent、dsh-subagent-fork-in-process、dsh-subagent-in-process-driver、dsh-subagent-spawn-in-process、dsh-tool-subagent、dsh-tool-subagent-control、dsh-tool-subagent-report |
| Agent 与编排 | 目标 / 工作流 / Ralph | dsh-command-goal、dsh-goal、dsh-goal-round-driver、dsh-tool-goal、dsh-tool-ralph、dsh-tool-workflow、dsh-workflow、dsh-workflow-worker-thread |
| Agent 与编排 | 命令系统 | dsh-command-compact、dsh-command-feedback、dsh-commands、dsh-native-command |
| 工具与执行 | 文件系统与工作区 | dsh-fs、dsh-fs-local、dsh-fs-observation-policy、dsh-fs-sandbox、dsh-tool-fs、dsh-tool-fs-search、dsh-tool-str-replace-editor、dsh-workspace |
| 工具与执行 | Shell 与终端 | dsh-bash-local、dsh-bash-sandbox、dsh-pwsh-local、dsh-pwsh-sandbox、dsh-shell、dsh-shell-env、dsh-terminal、dsh-terminal-bash、dsh-tool-bash、dsh-tool-bash-persistent、dsh-tool-pwsh |
| 工具与执行 | 子进程与代码执行 | dsh-code-runtime、dsh-code-runtime-worker-thread、dsh-subprocess、dsh-subprocess-local |
| 工具与执行 | 沙箱与审批 | dsh-permission-presets、dsh-sandbox、dsh-sandbox-local、dsh-sandbox-policy、dsh-sandbox-windows-acl、dsh-user-approval |
| 工具与执行 | 后台任务 | dsh-jobs、dsh-jobs-local、dsh-tool-jobs |
| 工具与执行 | 工具注册与提示 | dsh-mcp-client、dsh-repeat-tool-reminder、dsh-tool-ask-user、dsh-tool-call-timeout-policy、dsh-tool-cordis、dsh-tool-todo、dsh-tools |
| 会话与记忆 | 会话存储与查询 | dsh-session、dsh-session-checkpoint-policy、dsh-session-persistence、dsh-session-persistence-jsonl、dsh-session-projection、dsh-session-projection-cache、dsh-session-query、dsh-session-query-sqlite、dsh-session-reference、dsh-session-stats |
| 会话与记忆 | 标题与摘要 | dsh-session-title、dsh-session-title-first-prompt-llm、dsh-session-title-llm |
| 会话与记忆 | 压缩与上下文管理 | dsh-compaction、dsh-compaction-basic、dsh-compaction-tool-result-pruner、dsh-schedule、dsh-spill、dsh-spill-local、dsh-spill-policy、dsh-time-context、dsh-tmux-context |
| 会话与记忆 | 附件 / 导出 / 反馈 | dsh-attachment、dsh-attachment-local、dsh-message-feedback、dsh-session-log-export |
| 技能 | 技能系统 | dsh-skill、dsh-skill-badge、dsh-skill-filesystem、dsh-tool-skill |
| 安全 / 凭据 / 遥测 | 凭据 | dsh-credentials、dsh-credentials-local |
| 安全 / 凭据 / 遥测 | 匿名身份与遥测 | dsh-anonymous-user-id、dsh-session-telemetry、dsh-session-telemetry-otel |
| Web 界面 | 设置面 | dsh-client-locale、dsh-client-schema-form、dsh-client-ui-permission-presets、dsh-client-ui-settings、dsh-client-ui-settings-general、dsh-client-ui-settings-models、dsh-client-ui-settings-plugin-inventory、dsh-client-ui-settings-plugins、dsh-client-ui-theme、dsh-settings、dsh-settings-file |
| Web 界面 | 会话界面 | dsh-client-ui-agent-preset、dsh-client-ui-attachment、dsh-client-ui-commands、dsh-client-ui-conversation、dsh-client-ui-cordis、dsh-client-ui-deliverables、dsh-client-ui-goal、dsh-client-ui-input-trigger、dsh-client-ui-jobs、dsh-client-ui-message-feedback、dsh-client-ui-model-selection、dsh-client-ui-plan、dsh-client-ui-skill、dsh-client-ui-subagent、dsh-client-ui-tool、dsh-client-ui-trajectory、dsh-client-ui-user-questions、dsh-client-ui-workflow-run |
| Web 界面 | 布局 / 侧栏 / 工作区 | dsh-client-ui-directory-picker-browse、dsh-client-ui-directory-picker-native、dsh-client-ui-layout、dsh-client-ui-primitives、dsh-client-ui-sidebar、dsh-client-ui-slots、dsh-client-ui-workspace |
| Web 界面 | 外壳与运行时 | dsh-app-boot、dsh-client-connection、dsh-client-hmr、dsh-client-modules、dsh-client-runtime、dsh-client-web、dsh-client-web-react、dsh-cmdline、dsh-cordis-client-runner、dsh-cordis-host-runner、dsh-host-directory-picker、dsh-host-directory-picker-auto、dsh-host-directory-picker-browse、dsh-host-directory-picker-native、dsh-host-frontend-static、dsh-host-plugin-inventory、dsh-host-webserver、dsh-web-app、dsh-web-frontend |
| 基础设施 / 存储 | 存储 | dsh-storage、dsh-storage-domain、dsh-storage-json |
| 基础设施 / 存储 | 基础库 | dsh-atomic-write、dsh-base、dsh-brand、dsh-headless、dsh-home-paths、dsh-invariants、dsh-launch-environment、dsh-output-retention、dsh-scope、dsh-timeout、dsh-user-questions |
