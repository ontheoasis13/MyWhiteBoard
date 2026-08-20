# Proof C — Verification

状态：`NOT STARTED`

进入条件：Proof B 明确 `PASS`，且用户批准继续。

目标：真实执行后重新扫描 Repo，以新 Observed Code Truth 对照已接受的 Desired State，生成带 Evidence 的 Semantic Diff、测试结果与人工验收状态。

Agent 自述 `done` 不构成验证。没有重新观察 Repo、没有真实测试或 Evidence 无法定位时，Proof C 不能通过。

