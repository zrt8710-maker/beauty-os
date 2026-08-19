# Beauty OS

Beauty OS 是一个个人 AI 美妆管理 WebApp。它的核心不是帮助用户购买更多产品，而是管理用户已经拥有的护肤和彩妆资产，并基于皮肤状态、天气、库存和真实使用反馈，生成可解释的日常方案与购买判断。

当前版本：**v0.3 Release Candidate**。

> 当前版本尚未接入 AI、OpenAI、OCR、图片识别、向量数据库、RAG 或多 Agent。所有今日方案和购买分析均由确定性的 Rule Engine 生成。

## 核心理念

- 过去：我买了什么？
- 现在：我今天应该用什么？
- 未来：我是否应该买？

Beauty OS 优先最大化已有产品价值，减少重复购买和无效购买。它不是电商推荐系统，也不包含社区、广告、社交或复杂会员功能。

## 当前架构原则

### User Asset Layer

管理用户自己的事实数据：

- 皮肤档案与每日肤况
- 已拥有的产品和库存状态
- 产品图片与人工确认草稿
- 每日护肤方案
- 方案执行与产品反馈
- 购买分析历史

所有用户数据都以 `auth.uid()` 作为安全边界，并由 Supabase RLS 执行双用户隔离。

### Product Knowledge Layer

保存经过确认的产品知识：

- 产品目录
- 标准化成分
- 产品与成分关系
- 来源、证据和置信度

知识层不替代用户资产层。`catalog_products` 是只读知识，`products` 仍是用户实际拥有或确认录入的产品。目录关联必须经过用户确认。

### Rule Engine

使用确定性规则完成：

- 今日 AM/PM 护肤步骤排序
- 肤况与天气适配
- 产品过滤、评分与排除原因
- 最近 30 天使用反馈调整
- 重复产品、库存缺口、适配度和购买风险判断

相同输入会生成稳定、结构化、可解释的结果。规则层不依赖机器学习或大语言模型。

### AI 边界

AI 当前未接入。未来如引入 AI，只允许生成候选或结构化解释，不能绕过：

- 用户确认
- RLS
- Rule Engine
- 数据库状态机
- 原子 RPC

AI 不得直接创建用户资产、确认产品草稿或写入购买评分。

## 已完成模块

### 身份与档案

- Email OTP / Magic Link 登录
- Session 刷新和受保护页面
- 可选的单邮箱访问限制
- 长期皮肤档案、目标与护肤偏好

### 美妆资产库

- 手工创建产品
- 产品库存、剩余量和状态管理
- 产品软归档
- Private Storage 产品图片上传
- Signed upload URL 和 signed read URL

### Product Draft

- 图片关联的人工产品草稿
- 草稿编辑与状态完整性保护
- 原子确认产品、库存和图片关联
- 确定性的 barcode 或标准化名称目录匹配
- 用户可选择关联目录产品或保持纯手工产品

### 每日数据与方案

- 每日皮肤 check-in
- Open-Meteo 天气快照
- AM/PM 今日护肤方案
- 标准步骤顺序、产品评分和排除原因
- 敏感、湿度、UV、库存和历史反馈规则

### Usage History

- 完成、部分完成或跳过方案
- 产品级评分、不适等级和反馈标签
- 最近 30 天反馈统计
- 高反应阈值与 Rule Engine 调整
- 历史记录通过原子 RPC 写入，不允许客户端直接伪造

### Product Knowledge Layer

- Knowledge Source
- Catalog Product
- Ingredient
- Catalog Product Ingredient
- verified 知识只读策略
- 来源、证据与置信度保存

### Purchase Analysis

- 选择目录产品或手工输入候选产品
- 重复度、缺口、适配度、使用概率和风险评分
- `consider_buy`、`wait`、`do_not_buy`、`insufficient_data`
- 已有替代、风险、未知数据和原因码展示
- 不包含电商、价格抓取或新产品推荐

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- Supabase Auth、PostgreSQL、RLS 与 Private Storage
- Supabase JavaScript SDK 和 SSR helpers
- Zod
- Vitest
- pnpm

当前不使用 ORM。数据库结构以 SQL migration 和生成的 `database.types.ts` 为事实来源。

## 数据库状态

当前共有 **17 个 migration**，已在独立 staging Supabase 项目从零执行并验证：

```text
20260818000000_create_profiles.sql
20260818010000_create_products.sql
20260818020000_create_upload_assets.sql
20260818030000_create_product_drafts.sql
20260818031000_enforce_product_draft_state_integrity.sql
20260818040000_create_skin_checkins.sql
20260818041000_create_weather_data.sql
20260818050000_create_routines.sql
20260818051000_enhance_routine_rules.sql
20260818060000_create_usage_history.sql
20260818070000_create_product_knowledge.sql
20260818071000_add_product_draft_catalog_matching.sql
20260818080000_create_purchase_analyses.sql
20260818081000_stabilize_write_boundaries.sql
20260819000000_fix_stabilization_rpc_smallint_casts.sql
20260819001000_fix_rpc_least_greatest_resolution.sql
20260819002000_secure_confirm_product_draft.sql
```

主要业务表：

- `profiles`
- `products`
- `user_owned_products`
- `upload_assets`
- `product_drafts`
- `skin_checkins`
- `weather_data`
- `routines`
- `routine_steps`
- `usage_history`
- `usage_history_products`
- `knowledge_sources`
- `catalog_products`
- `ingredients`
- `catalog_product_ingredients`
- `purchase_analyses`

不要在 Supabase Dashboard 中直接修改生产数据库结构。所有数据库变更必须使用新的、只向前执行的 migration；不得修改已经执行的 migration。

## 环境要求

- Node.js `>= 20.9.0`
- pnpm `11.x`
- Supabase CLI（执行或验证 migration 时需要）

## 环境变量

复制 `.env.example` 为 `.env.local`：

PowerShell：

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux：

```bash
cp .env.example .env.local
```

应用环境变量：

| 变量 | 是否公开 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 是 | Supabase publishable key，由 RLS 保护 |
| `NEXT_PUBLIC_APP_URL` | 是 | 应用公开 Origin，本地为 `http://localhost:3000` |
| `AUTH_ALLOWED_EMAIL` | 否 | 可选单邮箱限制；个人生产实例强烈建议设置 |

不要把 service-role key、数据库密码或其他 secret 放入 `NEXT_PUBLIC_*`。普通应用请求和真实 RLS 测试都不得使用 service role。

## Supabase 配置

1. 创建独立的本地、staging 或生产 Supabase 项目。
2. 填写项目 URL 和 publishable key。
3. 在 Supabase Auth URL Configuration 中设置：
   - Site URL：`NEXT_PUBLIC_APP_URL`
   - Redirect URL：`${NEXT_PUBLIC_APP_URL}/auth/callback`
4. 个人生产实例设置 `AUTH_ALLOWED_EMAIL`。
5. 按顺序应用 `supabase/migrations/` 中的 migration。
6. 确认 `product-images` bucket 为 private。

本地 Supabase：

```bash
supabase start
supabase db reset
supabase gen types typescript --local --schema public > src/db/database.types.ts
```

已连接的远程测试项目：

```bash
supabase link --project-ref <staging-project-ref>
supabase db push --dry-run
supabase db push
supabase db lint --linked
supabase gen types typescript --linked --schema public > src/db/database.types.ts
```

执行远程命令前必须确认目标是 staging，而不是生产环境。

## 本地开发

安装依赖：

```bash
pnpm install
```

启动开发服务器：

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 测试与构建

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

真实 Supabase 双用户 RLS 测试需要在独立 staging 项目中配置：

```env
SUPABASE_TEST_URL=
SUPABASE_TEST_PUBLISHABLE_KEY=
SUPABASE_TEST_USER_A_EMAIL=
SUPABASE_TEST_USER_A_PASSWORD=
SUPABASE_TEST_USER_B_EMAIL=
SUPABASE_TEST_USER_B_PASSWORD=
```

然后运行：

```bash
pnpm run test:integration:rls
```

真实 RLS 测试按文件串行执行，并使用 30 秒 hook/test timeout，避免共享测试用户造成并行数据污染。

## RLS 验证状态

Beauty OS v0.3 已在 staging Supabase 项目完成验证：

- Migration：17/17
- Test Files：10/10 passed
- RLS Tests：48/48 passed
- Failed：0
- Timeout：0
- Skipped：0
- Database lint：passed
- Application lint：passed
- Typecheck：passed
- Production build：passed

真实测试覆盖：

- profiles 双用户隔离
- products 和 inventory 双用户隔离
- upload_assets 与 private Storage 隔离
- product_drafts 隔离、状态机和确认 RPC
- routines 与用户库存关系隔离
- usage_history 受控写入边界
- Product Knowledge 只读权限
- purchase_analysis 受控写入边界

## 主要页面

- `/app`：应用入口
- `/profile`：皮肤档案
- `/check-in`：每日肤况与天气
- `/inventory`：美妆资产库
- `/product-drafts`：产品草稿确认
- `/knowledge/products`：产品知识查看
- `/today`：今日护肤方案
- `/purchase-advisor`：购买判断

## 开发边界

- 不允许业务逻辑写入 React component。
- 所有 API 输入必须经过 Zod validation。
- 所有普通请求使用用户 session 并继承 RLS。
- 不使用 service role 模拟普通用户。
- 所有派生结果必须由 Service 或受控 RPC 生成。
- 不允许客户端直接写入评分、决策或匹配证据。
- 不为未来功能提前创建复杂抽象。
- 当前不接入 AI、OpenAI、OCR、RAG、Knowledge Graph 或 Multi Agent。

## 设计文档

- [Beauty OS v0.2 Development Specification](./BEAUTY_OS_V0.2_DEVELOPMENT_SPECIFICATION.md)
- [Beauty OS v0.1 Technical Design](./BEAUTY_OS_TECHNICAL_DESIGN.md)
