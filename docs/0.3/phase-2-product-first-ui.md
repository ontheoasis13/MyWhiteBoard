# My Whiteboard 0.3 — Phase 2 Product-first UI

状态：`PASS`

Phase 2 把 Living Project Model 的 Product Map Projection 变成默认入口，同时保留 0.2 Board View 作为明确的兼容入口。界面文案使用中文；布局状态与语义状态分离。

## 已交付

- Product View 默认打开，显示一级产品能力、Feature 卡片、层级关系和 `UNDERSTOOD / GROUNDED / ACTIONABLE` 状态。
- Product Group 与 Feature 使用不同视觉层级，Group 不是可执行目标；隐藏 Feature 只从 Product Map Projection 隐藏。
- Feature Inspector 展示所属能力、产品状态、子功能、理解状态和 Evidence 摘要，并提供了解、分析、准备修改、人工改名、分组、隐藏/恢复和恢复自动识别入口。
- Search、Focus、Breadcrumb、Freshness、Partial/Failed opening 状态已加入。
- Product Map 卡片支持拖动，布局写入 `visualLayout`，重启/重扫不覆盖人工布局。
- `Board View 0.2` 保留 Semantic Board State 与 Excalidraw Adapter 路径；Product View 不会覆盖白板状态。
- Changes 入口只作为后续工作入口，本阶段没有实现 Phase 3 Change Planning、Safe Execution、Impact UI 或 Execution Dashboard。

## 两个验收项目

1. **Project A — My Whiteboard**：对真实 `plugins/my-whiteboard` 进行 Product Grounding，验证 7 个一级产品能力、20 个 Feature、Evidence 关联和过期提示。
2. **Project B — 普通 TS/JS fixture**：使用 `plugins/my-whiteboard/tests/fixtures/product-grounding-alias-app`，验证非 My Whiteboard 项目也能生成同一 Product Map Projection、Feature Inspector 和布局持久化结构。

## 验证结果

- 真实 standalone workspace 在浏览器中打开后默认显示 `My Whiteboard · 产品视图`。
- 浏览器检查通过：Product Map 渲染、Feature Inspector 选择、Board View 入口、搜索过滤均可用；中文 UI 与过期提示可见。
- `npm test`：`56/56` 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- MCP smoke：`42` tools，通过。

Phase 2 Gate 完成后暂停，未进入 Phase 3。

## 环境备注

本次源仓库的 standalone runtime、HTTP 验收和 MCP smoke 均通过。当前桌面连接器缓存中缺少 `0.2.0-alpha.3/scripts/workspace-server.mjs`，直接从该旧缓存调用 `workspace_open` 会报 `MODULE_NOT_FOUND`；这是插件缓存刷新问题，不是本次仓库代码问题。重新安装/刷新该插件缓存后即可使用同一 standalone runtime。

机器可读证据见 [`evidence/phase-2-results.json`](evidence/phase-2-results.json)。
