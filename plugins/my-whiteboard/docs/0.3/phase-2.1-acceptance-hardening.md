# My Whiteboard 0.3 — Phase 2.1 Acceptance Hardening

状态：TECHNICAL READY — CLEAN-ROOM GOLDEN TEST PENDING

本轮以 `b4e2bae8fc7980b98992e7c4a09255ae58fe07e0` 为基线，未移动 `v0.3-proofs-pass` 或任何 0.2 release tag。硬化范围只覆盖 Product Structure Proposal、Observation v2、Product View 语义和 Agent guidance，不进入 Phase 3。

## 已完成的技术边界

- Proposal 的 `confirm` / `reject` 只能由带会话认证的 Product View HTTP UI 触发。MCP Agent 调用会收到 `HUMAN_APPROVAL_REQUIRED`；`update` 仍允许 Agent 修改自己的 pending 草案。
- `FeatureProposal.groupKey` 是唯一权威关系。Core 派生 `groups[].memberFeatureKeys`，校验重复 key、缺失名称、非法 groupKey、未显式声明的 ungrouped，以及分组全部未关联的 malformed proposal。
- 同一 project、Agent、RepoSnapshot 的新 pending proposal 会将旧草案标记为 `superseded`，避免堆积同义草案。
- HTML 观察区分 `ui_entry`、`auxiliary_html`、`generated_artifact`；debug/helper 与项目地图导出不会贡献主 Product Signals，vendor/min 文件继续排除。
- Presence UI 不再把缺少 heartbeat 直接解释成“离线”，而显示已注册、最近活动或最近未活动；无 Agent 时提供 MCP 连接说明。
- 产品结构状态（等待人工确认/已确认）与 Feature Understanding / freshness 分轴表达。技术白板空状态明确说明只有查看代码架构、模块关系或自由绘图时才创建。
- Agent guidance 明确 `product_structure_propose → STOP → 人工在 Product View 确认`，并禁止自动生成替代 Product Map 的 HTML/PNG/project-map artifact。

## 回归结果

本地技术验证覆盖既有 Proof A/B/C、Phase 1/1.1/2 回归及新增 Phase 2.1 hardening tests。最终命令结果记录在 `docs/0.3/evidence/phase-2.1-acceptance-hardening-results.json`。

## 外部验收边界

Codex 当前不能代替 WorkBuddy 客户端完成 clean-room Golden Test，也不能代替真实用户完成 Human UX Test。因此本文件不宣称两项真实外部验收已通过；完成技术验证后暂停，等待新的 WorkBuddy session、fresh `.my-whiteboard` 与真实用户回答验收问题。
