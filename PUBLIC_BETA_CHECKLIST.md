# Maintainer Alpha Release Checklist

- [x] Beta 5 完整备份、SHA-256、baseline commit/tag
- [x] 0.2 独立开发分支
- [x] 19 项自动测试、28 工具烟雾测试
- [x] TypeScript、生产构建、npm audit、Plugin/Skill 校验
- [x] 独立浏览器工作区视觉检查，无 iframe
- [x] Supabase `002`—`004` 迁移和回滚事务测试
- [x] Secret Key 精确扫描无命中
- [x] 真实 Codex CLI 交接创建测试
- [x] WorkBuddy 5.3.5 完成真实客户端核心接收/回信测试（Workspace v9、Handoff v2）
- [x] 在 WorkBuddy 连接器管理中信任 `my-whiteboard`，完成真实 MCP Transport 工具直调
- [ ] 安装 `gh` 并认证
- [ ] 推送 `agent/workspace-v0.2`、baseline tag 和 release tag
- [ ] 创建 Draft PR，审阅后合并到 `main`
- [ ] 在干净 Codex 环境从 GitHub tag 安装
- [ ] 用两个真实 Supabase 用户做跨设备/RLS 测试
- [ ] GitHub 开启 Issues 与 private vulnerability reporting
- [ ] 发布 ZIP SHA-256 与已知限制
