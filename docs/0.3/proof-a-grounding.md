# Proof A — Grounding

## Gate

证明真实 TS/JS Web 项目可以稳定生成面向产品的 Product Map，并且每个自动推断的 Feature 都能回到真实、可定位、带仓库修订版本的 Evidence。

状态：`PASS`

## Baseline Audit

- 分支：`agent/v0.3-control-loop`
- 基线 HEAD：`d64e2bb67772fa24f98a1c5ed5370b25eab5473f`
- 开工 dirty state：干净；MCP 连接后仅产生预期的 Workspace v77 Agent 记录。
- 包结构：仓库根为 marketplace；运行包位于 `plugins/my-whiteboard`。
- 测试：Node test runner，基线 34 个测试全部通过。
- 门禁：`npm test`、`npm run typecheck`、`npm run build`、`node scripts/smoke-test.mjs`。
- MCP：基线 28 个工具，工具定义与调度位于 `plugins/my-whiteboard/server/mcp.mjs`。
- Code Board / scanner：`plugins/my-whiteboard/core/code-analysis.mjs`。
- Workspace / Board schema：`plugins/my-whiteboard/core/schema.mjs`；事务与持久化：`plugins/my-whiteboard/core/store.mjs`。
- Standalone Workspace UI：`plugins/my-whiteboard/apps/workspace/src/App.tsx`；HTTP 与启动器位于 `server/workspace-http.mjs`、`server/workspace-launcher.mjs`。
- Agent / Handoff / Message：`core/domain.mjs`、`core/collaboration.mjs`。
- 0.2 Migration：`core/legacy-import.mjs`，copy-only、按 source hash 幂等，Legacy SVG 不参与实时同步。
- Codex / WorkBuddy：通过同一 Agent-neutral MCP 工具集接入，没有客户端专属 Core 分支；示例位于 `examples/workbuddy.mcp.example.json`，真实验收证据位于 `docs/validation`。

## Existing Scanner Audit

可以复用：

- 有界目录遍历、源文件白名单和生成目录排除框架。
- 稳定的 file node ID、Semantic Board 元素格式与 Code Board 分析器。
- 相对 import 的扩展名 / index 解析思路。
- MCP 的 structured result、独立工具 schema 与 smoke 基础设施。

需要重构：

- 扫描结果受文件系统遍历顺序和 `maxFiles` 截断影响，必须排序后再截断。
- 当前扫描会进入已构建的 `assets/workspace/assets`，真实仓库中产生大量打包文件噪声。
- 依赖提取只接受 `.` 开头的相对 import，不解析 `tsconfig/jsconfig` path alias，也不覆盖 re-export 和动态 import 的完整形态。
- Code Board 是技术文件图，不是面向非技术用户的 Product Map。
- 现有节点只有 file metadata，没有 page / route / api / symbol / test / database / reference 证据层。

### 11 nodes / 0 edges 根因

旧实现只保留 `specifier.startsWith(".")` 的依赖。此前真实测试项目使用 `@/...` 一类别名导入，因此 11 个文件都能成为节点，但所有本地依赖在过滤阶段被丢弃，最终出现 11 nodes / 0 edges。若再叠加未排序的 `maxFiles` 截断，目标文件不在扫描集合内时，相对 import 也无法成边。

Proof A 使用一个 11 文件、仅通过 `@/...` 连接的受控 fixture 固化该回归，同时在真实 My Whiteboard TS/JS 项目上验证生成目录排除和真实 Evidence。

## Grounding Architecture

```text
Repo snapshot
  -> deterministic source inventory
  -> import / route / API / symbol / test / database observations
  -> confirmed Evidence (with file, line, revision)
  -> possible Product Inference (must cite Evidence IDs)
  -> durable Human Intent overlay
  -> Product Map projection
```

物理 Proof 模型保持克制：

- `ProjectModel`：扫描版本、仓库修订、统计、Feature / Evidence / Human Intent。
- `Feature`：稳定概念 ID、产品名称、描述、状态、groundingRefs、humanIntent、actionability。
- `Evidence`：type、source、target、repoRevision、observedAt、certainty、details。

Feature ID 来自产品概念，不依赖单一文件路径。文件移动后，只要产品概念信号仍存在，Feature identity 保持稳定。

## Deterministic vs Semantic

确定性提取：

- source file 与 import / re-export / dynamic import / require 关系
- tsconfig / jsconfig path alias
- Next.js filesystem page / route
- React Router path
- Express / Fastify 风格 HTTP route
- MCP tool 名称
- exported symbol / component
- test file 与测试标题
- Prisma model / SQL table（存在时）

语义推断：

- 多个技术信号属于哪个用户可理解的产品能力
- Feature 名称、描述与分组
- 相似 Feature 是否合并

语义推断必须产生 `semantic_inference` Evidence，certainty 为 `possible`，并引用其确定性 Evidence。Proof A 不允许无来源的 Feature。

## Human Correction Persistence

人工纠偏不修改 Observed Evidence。纠偏以独立 `humanIntent.featureCorrections` 保存，包含版本、补丁、理由与确认 Evidence。每次重新扫描先重建 Observed Truth，再应用 Human Intent overlay。因此：

- 进程重启后可重新读取；
- 重新扫描只替换观察层；
- 人工名称、描述、分组与隐藏意图不被覆盖；
- Grounding refs 仍指向最新观察证据；
- 后续可以显式 supersede，而不是静默丢失。

## Test Matrix

| 项目 | 目的 | Gate |
| --- | --- | --- |
| `tests/fixtures/product-grounding-alias-app` | 复现 11 nodes / 0 edges，验证 alias、路由、API、测试与人工纠偏 | PASS：11 nodes / 11 edges，3 Features / 41 Evidence |
| My Whiteboard `plugins/my-whiteboard` | 真实中等规模 TS/JS Web 项目，验证噪声过滤、Product Map 与证据追溯 | PASS：42 files，15 Features / 279 Evidence |

## Result

### Product Maps

受控项目自动生成：账号管理、账单管理、项目管理、设置。真实 My Whiteboard 自动生成：智能体协作、项目产物、可视化白板、云同步、代码地图、项目上下文、项目决策、智能体交接、旧版迁移、协作消息、产品地图、项目管理、聚焦上下文、任务管理、工作区。

真实项目的一级 Product Map 已收敛为 6 组、2 层：

| 一级产品能力 | 子能力 |
| --- | --- |
| 工作区与地图 | 工作区、可视化白板、代码地图、产品地图 |
| 项目知识 | 项目上下文、项目决策、项目产物 |
| 项目推进 | 项目管理、任务管理 |
| AI 协作 | 智能体协作、智能体交接、协作消息、聚焦上下文 |
| 同步与扩展 | 云同步 |
| 兼容与维护 | 旧版迁移 |

分组和父子关系属于 Product Inference / Human Intent；每个一级组有自己的 `semantic_inference` Evidence，绝不改写 Feature 的 Code Truth。

这些 Feature 只从 page / route / API / MCP operation 等产品信号产生；普通文件和模块不会单独变成 Product Feature。每个自动 Feature 至少包含一个 confirmed Observed Evidence 和一个 possible `semantic_inference` Evidence。

### Human correction

`feature-billing` 从 v1 更正到 v2，名称改为“订阅与账单”。测试随后：

- 在独立 Node 进程中重新读取，纠偏仍存在；
- 重新扫描后名称、描述、Feature Version 与 human confirmation 仍存在；
- 同时将 `feature-billing` 移入“项目知识”，并挂到 `feature-project` 之下；重启和重扫后 parent/group 仍存在；
- Observed Evidence 更新到新的扫描时间；
- 使用旧 expected version 的写入被 `VERSION_CONFLICT` 拒绝；
- 纠偏没有修改或伪造 Observed Code Truth。

### MCP boundary

新增 3 个 Agent-neutral MCP 工具：`product_grounding_scan`、`product_grounding_get`、`product_feature_correct`。工具总数从 28 增至 31；structured result 与完整文本 fallback 均有自动测试和 JSON-RPC smoke 覆盖。

### Known misses

- v1 只为有界、字面可观察的 TS/JS Web 结构提供可靠自动 Grounding；运行时拼接路由、框架私有 DSL 与动态注册可能漏识别。
- UI-only 能力若没有路由、API 或协议操作信号，当前不会自动提升为 Feature，以避免技术模块冒充产品功能。
- test / database Evidence 可以确定性观察，但 v1 只在名称或路径关联可靠时挂到具体 Feature，避免制造虚假覆盖关系。
- monorepo 中的嵌套应用应分别以其应用根扫描；Proof A 不自动猜测所有 package boundary。
- 语义推断仍标记 `possible`。在用户确认 Product Map 前，不升级为 `confirmed`。

机器证据见 [evidence/proof-a-results.json](./evidence/proof-a-results.json)。层级修正后的完整回归为 39/39 tests、typecheck、build 与 31-tool smoke。Git SHA 在 Gate 提交后记录于阶段报告。

Proof A 的 Grounding、层级收敛、Evidence 保留和 Human Intent 持久化均通过，记为 `PASS`。可以进入 Proof B；Proof B 仍必须遵守真实 Agent、真实 Repo 和重新观察验证的约束。
