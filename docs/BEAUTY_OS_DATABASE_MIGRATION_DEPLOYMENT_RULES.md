# Beauty OS database migration deployment rules

本地 migration 文件存在，不等于远端数据库已经部署。任何 table、column、type、constraint、default、enum、RPC/function、trigger、RLS、index 或 view 的 contract 变化，都按以下流程完成。

1. `npx --yes supabase@2.116.0 migration list --linked`
2. `npx --yes supabase@2.116.0 db push --linked --dry-run`，只允许预期 migration；出现意外项立即停止排查。
3. 确认后执行 `npx --yes supabase@2.116.0 db push --linked`。
4. 再次运行 migration list，确认远端已有本轮 migration。
5. 验证远端真实 contract（列/表/RPC、RLS、default 和 constraint）。
6. 对受影响路径进行真实 authenticated GET 与 PUT/POST/PATCH、保存、刷新和持久化重载验证。

最终汇报必须分别说明：migration created、dry run verified、remote pushed、remote migration verified、authenticated runtime verified。仅 TypeScript 或单元测试通过不能替代远端验证；如果未 push，必须明确“本地 migration 已生成，但远端数据库尚未部署”。近期 schema 变更后出现 GET 200 但写入 500 时，按 migration list、dry-run、远端 contract、request schema、service mapping、repository、RLS、auth、application logic 的顺序排查。
