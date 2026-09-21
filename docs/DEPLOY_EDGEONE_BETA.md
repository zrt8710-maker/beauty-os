# Beauty OS → EdgeOne Makers Web Beta

本轮验证：typecheck 通过；1378 tests passed / 43 skipped；build 通过；本地 next start 生产 HTTP smoke 12/12 通过。Next NFT trace 确认包含两份知识文件，EdgeOne 最终 bundle 尚未生成。现有 A/B 测试账号远端登录探测均返回连接错误；受限模式外重试也未取得结果，故远端 RLS、migration state 和真实业务请求未验收。在线及手机验收均不能用上述本地结果替代。

## 结论与当前阻塞

官方支持 Next.js 16、App Router、RSC、SSR、Route Handlers、流式响应及 proxy。当前项目应使用 Next.js 全栈预设和 Node Cloud Functions，不做静态导出、不迁移 Edge Runtime。文档中的 redirects/rewrites 限制不能直接理解为禁止 HTTP 登录跳转：同一文档明确演示 `NextResponse.redirect`。Supabase cookies/session、Server Actions、callback 的具体适配结果必须云端验收。[Next.js 官方支持矩阵](https://cloud.tencent.com.cn/document/product/1552/127381)

**线上验收尚未完成。** GitHub 发布仓库为 `zrt8710-maker/beauty-os`；Makers 项目访问和正式域名仍需核实。未获得 EdgeOne Server → Supabase 的实测结果，不能写成已部署或已验证邮箱登录。没有执行数据库 reset、migration、模型请求或创建用户。

**简历域名阻塞：** Makers 项目域名和部署域名在中国大陆需带有效期为 3 小时的预览链接，过期返回 401。不能把这类链接当永久简历链接。需要绑定自定义域名；全球（不含中国大陆）加速区域绑定域名不要求备案，国内实际可达性仍须测试。首发可以先部署获得预览，但公开验收需要稳定域名。[官方域名规则](https://pages.edgeone.ai/zh/document/domain-overview)

## 最小部署配置

根目录 `edgeone.json`：Next 输出 `.next`、`pnpm build`、Corepack 激活项目指定 pnpm 后 `pnpm install --frozen-lockfile`；根目录选仓库根目录。不要选静态站点模式。保留 `.vercelignore`，EdgeOne 不依赖它。Git 忽略本地代理状态和诊断输出，防止把这些当发布源码上传。

本地实测 Node **22.23.2**、pnpm **11.19.0**；packageManager 已固定 pnpm。EdgeOne 构建 Node 配置为同一版本。注意官方列举的预装 Node 22.11.0 低于当前 pnpm 需要的 22.13；自定义版本存在安装失败风险，须查看第一次云端 install 日志，不能降到 22.11 冒充兼容。Cloud Functions 文档另列默认运行时 Node 20，和构建 Node 是不同设置；Next 要求 >=20.9，需确认实际运行补丁版本及适配器结果。[构建配置](https://pages.edgeone.ai/zh/document/edgeone-json)

平台当前 Cloud Functions 上限 **120 秒**、默认 30 秒、函数包最多 128 MB、请求/响应 body 最多 6 MB。已设置 `cloudFunctions.nodejs.maxDuration=120`，删除路由中的 Vercel 180 秒导出，保留 `runtime=nodejs`。Planner 75 秒、Narration 30 秒预算不变；理论只剩约 15 秒给其他读写，历史 60.5 秒不能证明线上尾延迟安全。真实生成频繁超过 120 秒才列超时 P0，不提前异步重构。[运行时限制](https://pages.edgeone.ai/zh/document/cloud-functions)

## 文件与 Node API

`node:fs`、`path`、`crypto`、Buffer、process.env 和 server-only 在 Node 路径保留。知识包读取是必要 runtime 依赖，已通过 `cloudFunctions.nodejs.includeFiles` 精确包含：

- `docs/CARE_DECISION_GUIDANCE_V0.1.md`
- `docs/ingredient-knowledge/INGREDIENT_KNOWLEDGE_PACK_V1.yaml`

Next 的 NFT trace 包含文件不等于 EdgeOne 已正确打包：首次云端需检查这两个文件及 process.cwd 相对位置。公共图片继续由 public 提供，用户图片使用 Supabase Storage；离线导入脚本文件写入不是在线主链，开发诊断默认在 production 关闭。不需要持久化本地磁盘或守护进程。图片上传应验证现有直传链路，以及识别请求是否触及平台 6 MB body 限制。

## 生产环境变量（全部值由控制台安全配置）

| 分类 | 变量 | 用途 |
| --- | --- | --- |
| Public | `NEXT_PUBLIC_APP_URL` | 最终稳定 HTTPS origin，不含预览 token；部署前设置，域名变更后重新 build/deploy |
| Public / Supabase | `NEXT_PUBLIC_SUPABASE_URL` | 保留现有 Supabase 项目 |
| Public / Supabase | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 代码实际读取此名称；不是 `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Server-only / Supabase | `SUPABASE_SERVICE_ROLE_KEY` | 现有受限服务端流程和签名，不得公开到浏览器 |
| Server-only / AI Providers | `VOLCENGINE_AGENT_PLAN_KEY`, `VOLCENGINE_AGENT_PLAN_MODEL`, `VOLCENGINE_AGENT_PLAN_BASE_URL` | 保持现有正常工作的模型、密钥、endpoint；Planner/讲解/对话等共用 |
| Server-only / AI Providers | `BAILIAN_API_KEY`, `BAILIAN_MODEL` | 保持图片识别能力时配置 |
| Optional / Server-only | `TODAY_CARE_PLANNER_KEY`, `TODAY_CARE_PLANNER_MODEL`, `TODAY_CARE_PLANNER_BASE_URL` | 有现有覆盖值则复制，否则继承共享 provider |
| Optional / Server-only | `TODAY_CARE_NARRATIVE_KEY`, `TODAY_CARE_NARRATIVE_MODEL`, `TODAY_CARE_NARRATIVE_BASE_URL` | 有覆盖值则保留，否则继承 Planner/共享 provider |
| Optional / Server-only | `WEEKLY_SKIN_NARRATION_KEY`, `WEEKLY_SKIN_NARRATION_MODEL`, `WEEKLY_SKIN_NARRATION_BASE_URL` | 有覆盖值则保留，否则继承共享 provider |
| Optional / Server-only | `SKIN_CONVERSATION_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_SKIN_CONVERSATION_MODEL` | 仅选择 OpenAI 对话时需要其 key；默认使用 Volcengine |
| Optional | `TODAY_CARE_PLANNER_OUTPUT_CONTRACT` | 保持当前值，不在部署时改变模型输出合同 |
| Dev-only / 禁止 production | `SUPABASE_TEST_*`, `OPENVIKING_*` | 不复制；特别禁止 single_user_dev。production 防护保持不变 |
| 已退役 | `AUTH_ALLOWED_EMAIL` | 中央配置忽略，生产不设置 |

代码 src 扫描没有 localhost、127.0.0.1、vercel.app 的 runtime 硬编码；本地 .env.example、测试及历史部署文档中的本地域名不是生产配置。旧 `.env.example` 中未被 runtime 引用的 OpenAI recognition/model 预留项不是上线必需。

## Supabase 与 SMTP

保留现有 `signInWithOtp` Magic Link，`shouldCreateUser:true`；新用户 `/profile`，已完成 onboarding 用户 `/app`，session/callback/admin 权限不改。

1. Authentication → Providers / Sign In → Email：启用 Email；开启允许新用户注册，保留邮箱确认。
2. Authentication → URL Configuration：Site URL=`https://最终稳定域名`；Redirect URLs 添加 `https://最终稳定域名/auth/callback`。本地 localhost callback 可以保留供开发。
3. Authentication → Email Templates：Confirm Signup、Magic Link 使用 `{{ .ConfirmationURL }}`；同一浏览器请求并打开登录链接。
4. Authentication → SMTP Settings：默认 SMTP 仅能向项目团队邮箱发信，可以做团队地址试发，不能验收任意新邮箱开放注册。部署可先做，公开注册需自定义 SMTP。[Supabase 官方 SMTP 说明](https://supabase.com/docs/guides/auth/auth-smtp)
5. 简单方案：已有可用 SMTP 就沿用；否则 Resend 验证自有发信域名后，Host=`smtp.resend.com`、Port=`465`、Username=`resend`、Password=其 API key，Sender 使用已验证域名地址。此 key 只填 Supabase SMTP，不加到网页 Public env。[Resend SMTP](https://resend.com/changelog/smtp-service)

## GitHub → Makers 发布操作

1. 先提供/授权目标 GitHub 仓库。当前有数百项历史未提交改动，不能仅推送本轮几个配置文件，也不能上传 output、密钥或个人诊断数据；需要形成可回滚的完整源码发布快照。
2. Makers → 导入 Git 仓库 → 授权目标仓库 → 选发布分支、仓库根目录、Next.js 全栈预设。使用 edgeone.json 配置及生产环境变量。[Git 导入指南](https://edgeone.ai/zh/document/171937194382536704)
3. 记录部署 ID、commit SHA、install/build 日志；检查 Node/pnpm、云函数 maxDuration、知识文件打包、包大小。
4. 获得平台 HTTPS 地址后先做预览 smoke；绑定稳定域名后同步 APP_URL、Supabase Site URL 和 callback URL，再部署。
5. 保留通过验收的部署。之后出问题切回该部署/其源码 commit；本轮没有 schema 变更，不需要数据库回滚。

## 数据库及验收门槛

本地 migrations 最新为 `20260917000000_add_scoped_routine_role_feedback.sql`；这不代表远端已应用。未获得远端 migration history 访问时不可写“schema 已匹配”。继续使用原项目，不 reset，不自动应用 migration。

部署后用两个独立邮箱验证新用户邮件、Profile 保存刷新、老用户数据、Logout。User A 创建专用 Profile/Inventory/Daily Skin/Routine；User B 对 A 记录读取为空、更新/删除不生效且 A 记录不变；有图片则验证 Storage 私有访问。普通用户 admin 页面/API 拒绝，不能改 Product Knowledge。不得将 mocked RLS 或 admin/service-role 查询当作用户隔离通过。

核心链：Inventory 新增保存刷新；Daily Skin conversation→confirm→finalize→history；Today 实际 AI 成功持久化，记录 total/planner/narration/status/timeout；相同条件更新应复用旧 routine、不再次调用两次模型；完整重新生成才绕过复用。模型失败、网络中断、刷新和重复点击检查保留有效旧 routine、真实保存状态、无重复 usage/扣量。最后手机 Safari/Chrome 视口验收。没有在线 URL 和用户 session 时以上均未验收。

现有 reuse 和按钮 busy 禁用保留；服务端没有跨实例单用户生成锁。不能用进程内 Map 假装实现分布式防重；现有 Supabase 原子 lease 需新增表/RPC及远端验证，本轮记 P1，不为此扩展架构。13 个测试 fixture lint error 保留。
