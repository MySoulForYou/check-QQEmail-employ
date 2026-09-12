# v3.5.3 邮件事件分流上线步骤

新版将“收到一封邮件”和“进入一个真实求职阶段”分开处理。上线必须遵循以下顺序，避免 Worker 在数据表尚未创建时停止同步。

## 需要用户执行

1. 打开 Supabase 项目的 SQL Editor。
2. 完整执行 `supabase/stage_notifications.sql`。
3. 确认 `stage_notifications` 表已创建，且历史带邮件 UID 的阶段已回填为 `approved` 或 `ignored` 通知。
4. 合并并部署本分支的 Web 管理端与云端 Worker。
5. 向测试邮箱发送或转发两封同阶段提醒邮件，确认待审大厅分别标记为“新阶段”和“提醒”，放行后只新增一个真实轮次。

## 可由 Codex继续完成

- 根据 `supabase/audit_duplicate_stages.sql` 的只读结果生成历史数据清理方案。
- 为每一组疑似重复阶段标出保留项、合并项和原因。
- 经用户确认后生成一次性修复 SQL，并在执行前再次提供影响行数预览。

## 回滚原则

迁移不会删除或改写 `applications` 与 `application_stages` 的既有记录。部署新版 Worker 前可以直接停止；若新版暂不启用，只需继续运行旧版代码，新增的辅助表不会影响旧流程。
