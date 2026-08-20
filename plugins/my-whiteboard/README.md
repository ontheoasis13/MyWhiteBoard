# My Whiteboard Plugin

Version: `0.2.0-alpha.3`

这是 My Whiteboard 的可分发插件目录。它包含：

- `core/`：Agent-neutral Semantic Workspace、Event Log、Entity OCC
- `server/`：40 个 MCP 工具和独立 loopback Web Workspace；其中包含 Change Contract、Process Adapter 与 Hosted Execution Bridge
- `apps/workspace/`：React + Excalidraw 编辑器源码
- `assets/workspace/`：离线可运行的生产构建与字体
- `adapters/`：Excalidraw 和可选 Supabase 适配器
- `supabase/migrations/`：Beta 5 兼容迁移与 Semantic Workspace 迁移
- `skills/whiteboard-design/`：Codex 使用规范

## 开发验证

```sh
npm install
npm test
npm run typecheck
npm run build
node scripts/smoke-test.mjs
```

云端 API：

```sh
cd cloud
npm install
npm run check
```

## 状态模型

`<project>/.my-whiteboard/workspace.json` 是本地唯一语义状态。Excalidraw 只投影并回写受支持的语义字段；Legacy Canvas 不参与实时同步。云端通过同样的 Entity 文档和 Event Log 复制状态，不成为额外画布格式。

## 云端安全

客户端只允许 Supabase Publishable Key、登录用户 JWT 和 RLS。`SupabaseWorkspaceAdapter` 会拒绝把 `sb_secret_...` 当成 Publishable Key。Secret/Service Role Key 不属于本插件运行时配置。

完整安装、迁移和测试说明见仓库根目录 README 与 `docs/`。
