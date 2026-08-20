# My Whiteboard 0.3 Scope Freeze v2

## North Star

My Whiteboard 0.3 要把白板从“可编辑图形”推进为“可驱动真实代码工作的可视化开发控制环”。项目、产品能力、代码证据、变更、执行与验证必须在同一语义模型中可追溯。

## 0.3 正式范围

- Project-first：用户首先看到产品能力，不先面对文件或模块图。
- Progressive Grounding：Product Feature 可逐层追溯到页面、路由、API、符号、文件、数据库、测试与引用。
- Truth Model：严格区分 Observed Code Truth、Product Inference、Human Intent 与 Desired State。
- 两个主视图：Product View、Change / Impact Focus View。
- 三档控制级别：Quick、Controlled、Guarded。
- Proof A / B / C 依次验证 Grounding、Execution、Verification。
- 目标技术栈：真实 TS/JS Web 项目，优先覆盖 React、Next.js、Vite 与 Node.js。

## Phase 0 冻结范围

Phase 0 只做技术证明，不做大规模新 UI。

1. Proof A：真实项目能生成非技术 Product Map，Feature 可追溯到技术 Evidence，人工纠偏在重启和重扫后仍保留。
2. Proof B：Whiteboard 接受的 Change 能通过 Agent-neutral 边界触发真实执行。
3. Proof C：执行后重新观察 Repo，用 Observed State 与 Desired State 生成可追溯验证结果。

Proof A 必须同时验证一个受控 fixture 和一个真实中等规模 TS/JS Web 项目。Proof A 完成后停止，不自动进入 Proof B。

## 明确延期

以下内容不属于 Phase 0 第一轮：

- 大规模 Product-first UI 改版
- 云端控制平面扩展
- Tauri / 桌面封装
- 多 Agent 编排器或专用 Agent Adapter
- 完整 User Flow View、Agent Work View、多套独立 Technical Graph
- LLM 直接从仓库名称猜 Feature

延期项与进入条件记录在 [deferred.md](./deferred.md)。

## 架构护栏

- Semantic Board State 继续是白板权威状态；Excalidraw 只是投影适配器。
- Product Grounding 不能覆盖 Observed Code Truth。
- Product Inference 必须引用 Evidence，并标记 certainty。
- Human Intent 独立持久化，重新扫描不得静默覆盖。
- Desired State 在被接受前不得冒充 Existing Product Truth。
- Entity Version 继续负责对象级并发；Workspace Version 继续负责 Event Log / Delta 顺序。
- 不以 Mock、Fake、手工补图或手工补边替代任何 Proof Gate。

