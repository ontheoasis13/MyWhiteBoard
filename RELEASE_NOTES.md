# Release Notes

## 0.2.0-alpha.3 — 2026-08-16

### Release metadata fix

- Fix `.codex-plugin/plugin.json` version: was stale `0.2.0-alpha.1+codex.20260814092814`, now `0.2.0-alpha.3`. This was the root cause of `codex plugin list` displaying the wrong version after the alpha.2 clean install.
- Bump all current runtime version sources to `0.2.0-alpha.3` (package.json, package-lock.json, plugin README, repo README, installers).
- Historical validation documents and Cloud independent version remain unchanged.
- No source code, Core, Presence, Persistence, or MCP Schema changes.

### Known limitations

- Same as 0.2.0-alpha.2 — no functional changes.

## 0.2.0-alpha.2 — 2026-08-15

### Real collaboration validated

- 真实 Codex CLI 单 Agent 全流程：17 次 MCP 调用零失败，Workspace v10 / 27 events。
- 真实 Codex + WorkBuddy 多 Agent 协作：Handoff、Task、Decision、Board 协作，版本化消息，v31→v42。
- 真实 Human Edit：人工移动/改名/新建矩形/删除/新建文本，v64→v75，11 事件（明确未用自动化替代）。
- 真实 Handoff：WorkBuddy 接受并完成两个 Handoff（UI/UX 审查 + Conflict/Delta 重放）。
- 真实 Conflict：stale expectedVersion 提交收到 VERSION_CONFLICT，v51 基线零脏事件。
- 真实 Delta：有序事件流 v46→v55，Delta/full ratio 约 17.2%。
- 真实 Restart：运行时 PID 36824→28444，持久化 SHA-256 不变；WorkBuddy 连接器重启续作。
- 真实 Legacy Migration：21/21 ID、10/10 连接、三份文件 SHA-256 一致、二次导入幂等 skip。

### Cross-device portability

> My Whiteboard Workspace 可以随 Git clone 到另一台机器后，由新的 Agent 继续读取；`project.root` 现在根据当前运行时路径 rebind，不再固化为原始创建机器的绝对路径。

### Runtime Agent Presence

> 历史 Agent Identity 继续保留，但超时 Agent 在读取时显示 offline，避免跨设备打开 Workspace 后历史 Agent 永久显示 connected。基于 `lastSeenAt` 和 `PRESENCE_TIMEOUT_MS = 5min` 的纯读取时推断，不改变 Schema、不推进 Workspace Version、不写入 workspace.json。

### MCP interoperability

- text JSON fallback：每个 MCP 工具结果在 `structuredContent` 和 `content.text` 中均包含完整 JSON，兼容只读取 text 的客户端。
- explicit Board schema：Board create/update/delete 需要显式 `{ op, element }` 结构和 `expectedVersion`。
- Task status schema：Task 状态枚举 `todo | in_progress | blocked | done | cancelled`，`completed` 仅用于 Handoff。
- WorkBuddy 5.3.5 兼容性已通过真实 stdio Transport 验证。

### Validation Task Cleanup

- 5 个验收 Task（task-model-mcp/core/adapter、task-verify-persistence、task-acceptance-summary）通过正常 `tasks_apply` MCP 版本化事务更新为 done。

### Test coverage

- 34 项自动测试通过（23 原有 + 11 新增 portability/presence regression）。
- TypeScript typecheck、生产构建、28 工具 stdio Smoke、plugin/skill 校验全部通过。

### Known limitations

- 当前为 Human-in-the-loop Multi-Agent Workspace，无自主 Coordinator。
- 无自动 Agent 调度、自动模型路由。
- Excalidraw 生产包较大，构建出现非阻断 chunk-size 警告。
- Selection Context 效率未单独量化。
- Cloud / Supabase 跨真实用户测试仍有限。
- Supabase 登录用户 JWT 需在启动前通过环境变量提供。
- Cloud Pull 拒绝覆盖未推送的本地变化；自动冲突合并不在 Alpha 范围。

## 0.2.0-alpha.1 — 2026-08-14

- 以本地 Beta 5 完整源码建立备份、Git baseline 和 `beta5-source-baseline` 标签。
- 引入 Agent-neutral Semantic Workspace；Semantic Board State 成为唯一白板权威状态。
- 新增 Workspace Version Event Log / Delta 与 Entity Version optimistic concurrency。
- 新增独立 Web Workspace、Excalidraw Adapter、离线字体和无 iframe 打开路径。
- 完成 Single-Agent Board Integration，以及 Context、Tasks、Decisions、Artifacts、Agent Identity。
- 新增 Agent Sync、Handoff、Messages 和多代理 Delta 工作流。
- 新增 Beta 5 只读发现/幂等迁移，不修改旧源文件。
- 新增可选 Supabase Semantic Workspace 表、RLS、Realtime、原子 RPC 和本地 push/pull Adapter。
- 新增 JSON/SVG/PNG 语义导出与代码架构扫描/分析。
- MCP 工具输入 Schema 根据真实 Codex CLI 验收结果收紧。

Known alpha limitations:

- Supabase 登录用户 JWT 目前需要在启动 Codex 前通过环境变量提供。
- Cloud Pull 会拒绝覆盖未推送的本地变化；自动冲突合并不在本 Alpha 范围。
- WorkBuddy 5.3.5 已完成真实接收/回信闭环，并通过受信任的 `my-whiteboard` stdio Server 完成标准 MCP Transport 工具直调。
- Excalidraw 生产包较大，构建会出现非阻断 chunk-size 警告。

## Public Beta 5 — 2026-08-13

Beta 5 保留为迁移输入和必要回退基线，不再承担 0.2 的实时状态管理。
