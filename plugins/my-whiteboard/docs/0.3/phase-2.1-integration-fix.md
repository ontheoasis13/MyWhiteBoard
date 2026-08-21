# My Whiteboard 0.3 — Phase 2.1 Integration Fix

状态：PASS — Integration Fix 完成；不进入 Phase 3

本轮只修复 Source → Build → Served Runtime → 持久化状态 → Browser UI 的断链。Proof A、B、C 与 Phase 1/1.1 的结论未改写。

## 基线与最终版本

- 基线：`865740049f8b7ca71deb68be928be865aa00d130`
- Integration Fix 实现提交：`755e6065c3da60dd6990a185a1d66a198efdd55b`
- 分支：`agent/v0.3-control-loop`
- 插件版本：`0.2.0-alpha.3`
- MCP 工具总数：46
- `v0.3-proofs-pass` 与任何 0.2 release tag 未移动

## 基线失败证据

先运行新增的 Integration Contract Tests，故意不重建 `assets/workspace`：

- I1 失败：served bundle 仍缺少“技术白板”等中文 Product View 标签，证明运行时仍在加载旧构建产物。
- I2 失败：Agent 实体没有 `registeredAt` / `lastActivityAt`，Presence 无法消费可靠的最近活动字段。
- I3、I4、I6 通过；I4 的第一次失败是测试断言把 12 个 Feature 错误地要求为每组 2 个，已在测试本身修正，不计为产品失败。

这组失败把问题定位在 Served Build 与 Presence Persistence 层，而不是 Grounding 或 Product Inference 层。

## 修复内容

1. Agent 连接与同步持久化 `registeredAt`、`lastActivityAt`，Product View 显示“已注册 · 最近活动：刚刚 · 通过 MCP”。
2. Product Structure 确认增加不可伪造的 HTTP 会话 provenance：`actorType=human_ui`、`sessionId`、`timestamp`、`proposalId`、`proposalVersion`、`baseRepoSnapshot`。MCP 路径由服务端固定为 `approvalSource=mcp`，即使 Agent 伪造 `actor.client=product-view` 也会收到 `HUMAN_APPROVAL_REQUIRED`。
3. 重新生成并提交实际由 `workspace-http` 服务的构建资产；中文导航、技术白板空状态、Feature Inspector 的“查看依据与实现”现在进入 active bundle。
4. 新增 `tests/phase2.1-integration.test.mjs`，覆盖 served bundle、Presence、MCP/HTTP approval boundary、5-group/12-feature hierarchy persistence 与 guidance stop。

## Browser QA 证据

使用真实 served `workspace_open` 页面验证：

- Product View 显示 5 个一级产品能力、12 个功能，并将功能放入正确 group。
- 左侧 Agent 显示“已注册 · 最近活动：刚刚 · 通过 MCP”，未显示离线。
- Feature Inspector 立即显示产品推断依据、Evidence 摘要；“查看依据与实现”会真实展开 Evidence，“深入分析”不再提供无效的 setStatus 假动作。
- 技术白板空状态显示：“尚未创建技术白板。产品地图已经可以正常使用。只有当你需要查看代码架构、模块关系或自由绘图时，才需要创建技术白板。”

截图：

- `docs/0.3/evidence/screenshots/phase2.1-integration/product-view-5-groups.png`
- `docs/0.3/evidence/screenshots/phase2.1-integration/presence-and-product-map.png`
- `docs/0.3/evidence/screenshots/phase2.1-integration/feature-inspector-evidence.png`

## Gate 结果

- Integration Contract Tests：5/5 通过（纳入总测试后 67/67）
- `npm test`：67/67 通过
- `npm run typecheck`：通过
- `npm run build`：通过，且构建资产已提交并由 served runtime 使用
- MCP smoke：通过，46 tools
- 主仓库：clean

结论：Phase 2.1 Integration Fix PASS。按指令在此暂停，不进入 Phase 3。
