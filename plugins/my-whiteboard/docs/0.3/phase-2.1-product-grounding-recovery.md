# My Whiteboard 0.3 — Phase 2.1 Product Grounding Recovery

## 状态

技术实现已完成并在本地回归通过；真实 WorkBuddy Golden Path 与真人 UX 验收尚未执行，因此本阶段结论是：

**TECHNICAL READY — REAL WORKBUDDY ACCEPTANCE PENDING**

不进入 Phase 3。

## 基线与保护项

- 分支：`agent/v0.3-control-loop`
- 开工基线：`c50554229981ec5bac72b19cb8e6b4484f40bcd0`
- 当前插件声明版本：`0.2.0-alpha.3`（未修改）
- `v0.3-proofs-pass` 的 peeled commit：`8f7213990982b33c71e05445fa39013ca1ed83df`（未移动）

## Observation v2

`source-observation.mjs` 现在观察 `.js/.mjs/.cjs/.ts/.tsx/.jsx/.html/.css/.prisma/.sql`，不再把 `public/` 作为整体排除目录。每个文件带有 `application_source`、`ui_entry`、`supporting_asset`、`test`、`generated`、`vendor` 或 `binary_dependency` 分类；`*.min.js/css`、vendor、generated、build/dist 与 node_modules 仍被排除。

Grounding 还记录 HTML title/heading/button/label/script entry、frontend `fetch()`、HTTP route、exported symbol、tests，以及 `node:sqlite`、数据库路径、SQL/Create Table/table name 等源代码 persistence evidence。SQLite binary 不被解析。

`observedFiles`、`unmappedProductSignals`、`repoSnapshot`、`understandingState` 和 `recommendedNextAction` 均被持久化。未知 route token 不再自动升级为最终 Feature；它们保留为 evidence-backed signals。

## Generic fixture

Fixture：`tests/fixtures/vanilla-fullstack-workbench/`

- `server.js`：Node server、四类 API、`node:sqlite`、数据库路径、`CREATE TABLE`
- `public/index.html`：标题、heading、button、label、script entry
- `public/app.js`：`fetch('/api/profiles')`、`fetch('/api/generate')`、`fetch('/api/performance')`
- `public/styles.css`：supporting asset
- `public/vendor.min.js`：验证 minified/vendor 排除

扫描结果：4 个 observed files（前端 JS、HTML、CSS、server），`NEEDS_INTERPRETATION`，API/fetch/UI/database signals 均有 Evidence，未知产品语义保留在 `unmappedProductSignals`，没有空的 My Whiteboard 专属产品组。

## Product Structure Proposal

新增 agent-neutral `ProductStructureProposal` aggregate 与 MCP 工具：

- `product_structure_propose`
- `product_structure_proposals_get`
- `product_structure_proposal_apply`

Proposal 必须绑定当前 RepoSnapshot，Feature 必须引用属于当前项目和快照的 Evidence。Proposal 默认 `pending`、`certainty=possible`，不修改 Code Truth、不自动成为 Change Target。confirm/reject/update 采用版本校验；快照变化会将 proposal 标记为 `superseded` 并阻止静默确认。confirm 会原子地写入产品结构与 Human confirmation provenance，并保留 Evidence refs。

## Understanding / Product View

保留旧 `status` 兼容，同时增加 `understandingState`：`READY`、`PARTIAL`、`NEEDS_INTERPRETATION`、`UNSUPPORTED`、`FAILED`。0 Feature 但有真实产品信号时显示 `NEEDS_INTERPRETATION`，并返回 `recommendedNextAction=PRODUCT_STRUCTURE_PROPOSAL`；Standalone UI 只提示外部 Agent 解释，不伪造自动 fallback Code Board。

Product View 增加待确认 Proposal banner、确认/逐项查看/拒绝入口和 stale 提示；Proposed 结构与 Existing Feature 分离显示。

## Board Node Inspector

active React Workspace 现在接收 Excalidraw selectedElementIds，识别带 `properties.code` 的 Semantic Code Node，显示路径、节点类型、Source Classification、符号/行号、直接/反向依赖、相关 API/Evidence、相关 Product Features 和“在 Product Map 中查看相关功能”。无关联时明确显示“暂无已关联产品功能”。`assets/canvas/` 未被重新接入，继续视为 legacy/unrouted。

## Runtime truth

新增 `my_whiteboard_info`。当前真实 MCP surface：**46 tools**。返回声明版本、Git source revision、schemaVersion、capabilities、toolCategories、supportedRepoHints 和 product-first recommendedFlows。初始化 instructions 也明确：

`project_create → product_grounding_scan → Host Agent interpretation → product_structure_propose → workspace_open Product View`

仅在用户明确要求代码架构时使用 `code_board_create`。

## 验证结果

- tests：60/60 通过
- typecheck：通过
- build：通过
- MCP smoke：通过，46 tools
- 0.2 workspace / Semantic Board / legacy import / Proof A-C / Phase 1/1.1 回归：通过
- 主仓库工作区：在提交前应保持 clean；本地 build 产生的 hashed assets 已纳入后续提交

## 未完成外部验收

当前 checkout 没有 `central-soe-content-workbench` 源码，Codex 也无法打开 WorkBuddy 客户端。因此本报告不声称真实项目 fresh scan、WorkBuddy proposal、Human confirm 或真人 Product UX PASS。需要用户在全新 WorkBuddy session 与全新 `.my-whiteboard` workspace 中执行 Golden Path 后，再由 Codex 读取同一 Repo/Workspace 独立核验。

## 风险

1. HTML 文案与未知 route 的语义质量仍依赖 Host Agent；deterministic scanner 不冒充产品语义。
2. Proposal confirmation 已有 stale gate，但多进程同时编辑 ProductModel 与 proposal 文件仍应在后续加强更细粒度事务审计。
3. Node Inspector 依赖 Semantic Code Node 的 `properties.code`；legacy canvas fork 仍未删除。
4. 当前没有自建 LLM/provider、Python Full Product Grounding、SQLite binary parser 或 Phase 3 Change Planning。
