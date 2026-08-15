# Alpha Privacy Notice

Last updated: 2026-08-14

My Whiteboard 默认只在本机项目的 `.my-whiteboard/` 中处理 Semantic Boards、Context、Tasks、Decisions、Artifacts、Agent Identity、Handoffs、Messages、Event Log、快照和导出。

只有用户显式配置并调用 Cloud 工具时，Semantic Entity 文档、版本、事件、成员身份和时间戳才会发送到配置的 Supabase 项目。上传前会移除本机项目绝对路径。

Supabase Publishable Key 可随客户端分发；登录用户 JWT 只应存在于本机进程环境或受保护的认证存储。Secret/Service Role Key 不得进入插件、浏览器资产、Git、白板、日志或公开问题。

本地文件由用户自行删除。云端记录由 Workspace 所有者或项目运营方按权限删除。Alpha 阶段只应使用非敏感测试数据。
