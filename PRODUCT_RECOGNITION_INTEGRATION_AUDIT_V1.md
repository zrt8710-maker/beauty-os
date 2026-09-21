# PRODUCT RECOGNITION INTEGRATION AUDIT V1

审计日期：2026-08-25  
范围：Product Recognition、Inventory Identity-first Flow、Identity Persistence。  
限制：仅审计；未修改应用代码、数据库或 Provider。

## 结论

当前系统为**部分闭环**。

名称输入可完成“识别候选 → 用户确认 → User Asset 创建 → 资产详情”的主路径；条形码继续通过既有 Lookup 进入相同确认与创建路径。图片入口已接入 Recognition API，但当前 Mock Provider 对图片固定返回无候选，因此图片路径只能进入 Unknown 兜底，尚不能完成“图片 → 候选”的业务闭环。

Recognition 本身不写产品、资产、Catalog、Knowledge 或 Rule Engine。Identity Persistence 也会在 Catalog 身份时重新校验 Catalog 候选并以 Catalog 值覆盖前端字段。但服务端尚未把“用户确认过 Recognition Candidate”作为创建 `external` 身份的可验证前置条件，且资产创建成功后会异步触发候选知识文件补全。这两点应在后续阶段收紧。

## 1. 当前用户路径

### 名称识别：可闭环

```text
产品名称（品牌可选）
→ POST /api/v1/product-recognition
→ Recognition Candidate
→ 用户点击“这是我的产品”
→ POST /api/v1/owned-products/with-identity
→ 创建 Product + User Asset
→ 打开资产详情
```

证据：Inventory 使用 Recognition API；单候选进入确认页；确认动作才调用 `with-identity`；创建成功后设置 `selectedOwnedProduct`，打开详情弹层。

身份字段在确认时由候选覆盖草稿中的品牌、名称、variant、barcode，再持久化。Catalog 候选还会在服务端重新匹配，并由 verified Catalog 的身份字段覆盖客户端提交值。

### 条形码：可闭环

```text
条形码
→ POST /api/v1/product-lookup
→ 候选/确认
→ 同一 Identity Persistence 创建路径
→ 资产详情
```

条形码仍不是 Recognition API 的输入模式，而是既有 Lookup 的入口；前端会将其转换到同一候选确认 UI。

### 图片：技术入口已接通，业务候选未闭环

```text
图片文件
→ 本地读取 data URL
→ POST /api/v1/product-recognition
→ 当前 Mock Provider 返回 no_match
→ Unknown 身份确认
```

图片不会被当前 Mock Provider 伪造成候选。这符合“不猜测身份”的原则，但意味着在真实 Vision Provider 接入前，图片不能产出 Recognition Candidate。

### Unknown：受控创建，但不是候选确认

Unknown 页面允许用户填写包装上的品牌（可选）和产品名称，并点击“添加我的产品”。系统以 `resolution_kind = unknown` 创建资产；明确产品词可由内部保守解析保留类型，信息不足时降级为 `other`。

这不是绕过已有候选：Unknown 分支没有可确认候选，且创建动作仍需用户显式点击。其风险在于服务端无法区分“经过 Recognition 失败后的 Unknown”与“任意调用方直接提交的 Unknown”。

## 2. 闭环检查结果

| 检查项 | 状态 | 结论 |
|---|---|---|
| 候选到确认 | 通过 | 单候选与多候选均需进入确认页；UI 不会在识别返回后自动创建资产。 |
| 确认后创建资产 | 通过 | 仅确认按钮调用 `with-identity`；默认 `unopened`、剩余量 100。 |
| 创建后展示详情 | 通过 | 创建成功后立即选择新资产并打开详情。 |
| 候选身份保留 | 部分通过 | 身份主字段和类型会传入 Persistence；`confidence`、`candidate_reason`、`candidate_source` 在 Recognition-to-Lookup 适配时被丢弃。它们不应进入资产库，但当前也未保留给确认界面或审计用途。 |
| 身份字段覆盖保护 | 通过（Catalog）/ 部分通过（external） | Catalog 在服务端二次校验并覆盖为 verified Catalog 字段。external/unknown 由请求值持久化。 |
| 重复创建保护 | 未通过 | 前端有 `isSaving` 禁用态，但 RPC 每次调用都会插入新的 Product 与 User Asset；未见幂等键、去重查询或唯一约束保护。网络重试或并发提交可能产生重复资产。 |
| Unknown 绕过确认 | 可接受但需界定 | Unknown 无候选可确认，仍需用户点击创建；但服务端不验证请求是否来自该流程。 |
| Recognition 直接写 Knowledge | 通过 | Recognition API/Service/Provider 仅返回 DTO，不写知识库。 |

## 3. Identity Boundary 审计

### Recognition

通过。Recognition API 只返回 Candidate DTO；Provider 接口只有 `recognize()`。其模块没有创建资产、写 Catalog、写 Product Knowledge 或调用 Rule Engine。

低置信度候选由 Recognition Service 过滤成 `no_match`，因而不会成为可确认的 Identity Candidate。

### Identity Persistence

部分通过。

- `catalog`：要求 Catalog ID，并经 matcher 和 verified Catalog 校验；数据库函数也校验 resolution kind 与 Catalog ID 的一致性。
- `external`：可以保存已确认的外部候选，`catalog_product_id = null`，身份状态为 `matched`。
- `unknown`：保存未识别身份，身份状态为 `unknown`。

缺口：`/api/v1/owned-products/with-identity` 接受任意合法的 `external` 请求，并不要求候选 ID、确认令牌或服务端会话证明。因此“只保存用户确认后的外部身份”目前由前端流程保证，不是服务端强制边界。

### Knowledge

Resolver 的读取边界符合要求：只有 `verified` care role 和 capability 可覆盖产品类型 fallback；candidate knowledge 不会进入能力或护理角色决策。

但资产创建成功后，`with-identity` 路由会异步启动 User Asset Knowledge Enrichment。对于无 Catalog 且有 barcode 的资产，它会写入本地 `knowledge-data/product-candidates` 下的 External Fact 与 Knowledge Candidate 文件。

这不是 Recognition 直接写知识，也不会写 verified knowledge 或 Catalog；但它建立了“创建资产 → 自动候选知识补全”的间接耦合。若本阶段要求 Recognition/Inventory 完全不触碰 Knowledge Pipeline，应将此异步调用移出资产创建路径。

### Rule Engine / Resolver

通过。Product Decision Resolver 只在有 Catalog ID 时读取知识快照；仅 verified knowledge 会生效。没有 verified knowledge 时，Rule Engine 使用产品类型 fallback 生成可用角色，不会阻断资产使用。

## 4. 用户界面语言审计

### Inventory 用户界面

通过。

- 添加页使用“拍照识别”“搜索产品”“找到几个可能的产品”“这是我的产品”。
- 候选确认页不展示 `candidate`、`verified`、`confidence`、`source`、`evidence` 或 `catalog` 等后台术语。
- 详情页将 `identity_status` 映射为“已识别”或“暂未识别”。
- 详情页将 Catalog 关联映射为“已有产品资料”或“暂无详细资料”。

注意：后台知识管理页会显示候选、来源、证据与可信度；其路径属于 Admin，不属于普通 Inventory 用户界面。

### 缺失的用户文案

资产详情尚未展示“可以参与今日方案”或等效状态。当前系统具备 Rule Engine fallback 能力，但这项能力没有在资产详情中转译为用户语言。

## 5. Asset Detail 审计

详情结构已按边界分离：

| 区域 | 当前字段 | 状态 |
|---|---|---|
| 产品信息 | 产品名称、品牌、产品类型、识别状态、产品资料状态 | 通过 |
| 我的资产 | 使用状态、开封日期、明确到期日、剩余量、用户备注 | 通过 |
| 身份编辑 | 详情页不允许编辑品牌、名称、variant、barcode、product type | 通过 |
| 重新识别 | 显示“重新识别产品（即将支持）”但禁用 | 符合当前阶段 |
| 今日方案可用性 | 未展示 | 缺失 |

购买日期没有出现在主要资产编辑页，符合 Asset Information v1.x 的范围。

## 6. 已完成部分

1. Recognition Candidate、质量字段、低置信度降级与 Provider 接口已建立。
2. 名称、条形码候选均复用同一确认与 Identity Persistence 路径。
3. 用户必须点击确认候选后才能通过前端创建已识别资产。
4. Catalog 身份由服务端和数据库函数双重校验。
5. Asset Detail 已区分产品信息与我的资产。
6. Resolver 与 Rule Engine 对 verified knowledge / product type fallback 的读取边界已实现。

## 7. 缺失部分与风险

### P1：外部身份确认不是服务端强制条件

外部身份创建可绕过 Recognition UI 直接调用 Identity Persistence。建议在下一阶段引入短期有效、服务端签发的确认令牌或确认会话；创建时验证候选、用户、身份字段及 resolution kind 一致。

### P1：重复资产创建没有幂等保护

当前 RPC 每次请求都会新建 Product 和 User Asset。建议下一阶段为创建请求引入幂等键，或在同一用户、同一确认身份、未归档资产范围内实施明确的重复策略。

### P2：图片识别尚无可用 Candidate Provider

当前图片入口只能走 Unknown。接入 GPT Vision/Gemini Vision 前，应以 Evaluation Dataset 验证 OCR、variant 消歧、冲突处理与低置信度回退。

### P2：Recognition 质量解释未到确认界面

API 返回 reason、confidence level 和 match method，但前端适配为旧 Lookup Candidate 时丢弃。普通用户不应看到后台置信度，但可以在未来展示非技术语言的“识别依据摘要”，或至少在服务端审计日志中保留。

### P2：资产创建与知识候选补全耦合

自动 enrichment 不会写 verified knowledge，但会写候选事实/候选知识文件。建议明确其是否属于本阶段允许的后台副作用；否则将触发移至独立任务调度入口。

### P3：详情缺少“今日方案”可用性语言

Resolver 已可 fallback，但资产详情未显示用户可理解的参与状态。建议以用户语言展示“可参与今日方案”或“可作为基础步骤参考”，且不展示 Resolver/knowledge 状态。

## 8. 下一阶段建议

1. 接入真实 Vision Provider 前，先以 `PRODUCT_RECOGNITION_EVALUATION_DATASET` 跑 Provider conformance tests。
2. 引入服务端确认令牌，封闭 Candidate → Persistence 的外部身份边界。
3. 为资产创建增加幂等与重复资产策略。
4. 决定 Knowledge Enrichment 是否从资产创建路由移至独立后台任务；无论选择何种方式，都维持 candidate 与 verified 的隔离。
5. 在资产详情增加非技术化的今日方案可用性提示，并保留当前“产品信息 / 我的资产”分区。

## 审计依据

- `src/features/inventory/inventory-manager.tsx`
- `src/app/api/v1/product-recognition/route.ts`
- `src/server/services/product-recognition-service.ts`
- `src/app/api/v1/owned-products/with-identity/route.ts`
- `src/server/services/create-owned-product-with-identity-service.ts`
- `supabase/migrations/20260824020000_add_product_identity_persistence.sql`
- `src/server/services/user-asset-knowledge-enrichment-service.ts`
- `src/server/services/product-decision-resolver-service.ts`
- `src/server/domain/product-decision/resolve-product-decision-profile.ts`
