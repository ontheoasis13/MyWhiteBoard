# Release Notes

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
- Claude Code 的最终真实接收验收受本机失效认证阻塞，重新登录后需重跑。
- Excalidraw 生产包较大，构建会出现非阻断 chunk-size 警告。

## Public Beta 5 — 2026-08-13

Beta 5 保留为迁移输入和必要回退基线，不再承担 0.2 的实时状态管理。
