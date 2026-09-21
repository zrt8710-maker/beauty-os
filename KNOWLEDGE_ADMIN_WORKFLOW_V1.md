# KNOWLEDGE ADMIN WORKFLOW V1

## 结论

现有架构已具备最小的离线审核链路：`External Product Fact → Knowledge Candidate → Review Manifest → Verified Seed → Catalog/Product Knowledge`。它足以作为 v1 后台审核的发布闸门，但尚未具备完整的 Admin 队列、审核动作记录和 capability/结构化成分候选能力。

本方案不要求真实 AI Provider、自动抓取、Rule Engine 改动、用户 Inventory 改动或 migration。

## 1. 当前 Schema 审查

| 能力 | 当前支持 | 说明 |
|---|---|---|
| 外部事实 | 支持 | `ExternalProductFact` 包含身份、barcode、原始 ingredients text、外部分类标签、来源与警告。 |
| Candidate identity | 支持 | `KnowledgeCandidate.identity_candidate` 可保存品牌、名称、variant、barcode。 |
| Candidate 分类 | 支持 | 可保存 category、product_type、映射来源、置信度与 warning。 |
| Candidate 护理角色 | 部分支持 | v0.1 仅 primary role candidate；来源可为 product-type mapping。 |
| Candidate 成分列表 | 不支持 | 当前只保存 `ingredients_text` 的事实引用，未解析为结构化 INCI candidate。 |
| Candidate capability | 不支持 | `capabilities` 被定义为 `z.array(z.never()).length(0)`，明确禁止候选能力进入当前 workflow。 |
| Review | 支持 | Review Manifest 强制人工确认身份、产品类型、primary role、证据来源、审核人和时间。 |
| verified 发布 | 支持 | compile 仅在 review 校验通过后生成 verified Catalog Seed 与 verified primary role Seed。 |
| reject / request review | 不支持 | 现有 Manifest 没有显式工作流状态、拒绝原因或复审分派字段。 |

Product Knowledge Snapshot 中 care roles、capabilities 和 evidence 均有 `candidate / verified / unknown` 或 review status 语义；Resolver 只使用 verified 数据。因此 Schema 层已经保持“候选不进入决策”的读取边界。

## 2. 目标后台工作流

```text
User Asset Created
  ↓
Knowledge Resolver
  ├─ 已有 verified knowledge：Resolver 直接读取并用于决策
  └─ 无 verified knowledge：产生 enrichment_suggested signal
       ↓
Knowledge Intake Queue（后台任务视图）
       ↓
External Fact / AI Candidate（后续独立生产）
       ↓
Admin Review
  ├─ approve → compile → verified seed → curator apply → verified knowledge
  ├─ reject → 保留拒绝原因，不发布
  └─ request review → 返回待补证据/待复审队列
```

`enrichment_suggested` 只是任务信号，不是知识生产，更不是 verified publication。资产创建必须立即完成；今日方案继续使用现有产品类型 fallback。

## 3. AI 与人工职责

### AI 可提供候选

- 产品身份：品牌、产品名、variant、barcode 的候选与冲突提示。
- 原始成分文本的转写与 INCI 解析候选；必须保留原始标签文本和字段级来源定位。
- product type candidate。
- care role candidate。
- capability candidate；每条必须附候选证据、来源 URL/定位与冲突信息。
- evidence summary：仅汇总已发现的证据，不下结论。

### 必须人工确认

- 品牌、名称、variant、barcode 是否对应同一实际产品。
- 成分文本是否来自正确包装/官方资料，INCI 解析是否准确且顺序完整。
- 来源权威性、适用市场/版本、获取日期与许可。
- product type 和护理角色是否与产品实际用途一致。
- capability 是否有足够、相关且未被反证的 evidence 支持。
- 所有从 candidate 到 verified 的 publication。

禁止 AI 直接写 Catalog、verified knowledge、Resolver 输入或 Rule Engine 输入。

## 4. Admin UI 设计

### A. 待处理产品队列

每行展示：

- 产品候选名称、品牌、variant、barcode。
- 关联资产数量与最近 suggestion 时间。
- 来源数量、最高来源等级、冲突数量。
- 状态：待审核 / 待补资料 / 已拒绝 / 可发布。
- 风险标签：身份冲突、版本不明、成分缺失、证据不足。

默认按风险、关联资产数量、等待时间排序；不向普通用户暴露此队列。

### B. 审核详情

分栏展示：

1. **身份**：候选值、原始包装/OCR 文本、外部事实、版本及条码冲突。
2. **来源**：来源类型、URL、抓取时间、市场、许可、质量分与原始定位。
3. **成分**：原始 ingredients text、解析后的 INCI candidate、缺失/冲突标记。当前需先扩展 Candidate Contract，不能直接进入现有 v0.1 Candidate Schema。
4. **分类与角色**：AI/规则候选、人工最终选择、覆盖候选的原因。
5. **能力与证据**：每项 capability candidate、支持/反证 evidence、来源定位与审核结论。当前需先解除 `capabilities: z.never()` 限制。
6. **审核记录**：审核人、时间、备注、动作、复审原因。

### C. 审核动作

| 动作 | 前置条件 | 结果 |
|---|---|---|
| `approve` | 身份、类型、角色、来源与必要 evidence 全部人工确认 | 生成可编译 Review Manifest；通过校验后才生成 verified seed。 |
| `reject` | 明确错误、重复、来源不可用或无法核实 | 不发布；保存拒绝原因与可选替代候选。 |
| `request review` | 信息不完整、来源冲突、需要第二审核人 | 进入待补资料/复审队列；不改变任何 verified 数据。 |

`approve` 不应直接写数据库。应沿用现有 `prepare → validate → compile → curator apply` 发布闸门，保证可预览、可校验、可审计。

## 5. 与现有 Admin UI 的差距

当前 `/admin/knowledge`：

- 支持手工添加标准产品、dry-run、apply。
- 支持查看 verified 产品的角色、能力与 evidence。
- 支持 Existing Asset Reconciliation 报告。

当前缺失：

- `enrichment_suggested` 任务列表与产品聚合。
- Candidate/Fact/Review 文件的后台浏览器。
- 来源、冲突、INCI、candidate capability 的审核界面。
- approve/reject/request review 状态机与审计记录。
- 从 review compile 到 curator apply 的一体化发布控制台。

因此 v1 Admin UI 应新增“待审核知识”工作区，而非扩展普通 Inventory 或让用户填写知识。

## 6. 建议的 v1 交付顺序

1. 将 `enrichment_suggested` 作为可列举的后台任务信号（不改变知识表）。
2. 增加 Candidate/Fact/Review 文件索引或受控任务清单；只读展示待处理项。
3. 实现身份、来源、分类、primary role 的审核详情和三个动作。
4. 接入现有 Review Manifest 的 validate/compile 流程。
5. 再扩展结构化 INCI candidate 与 capability candidate/evidence；在此之前保持 capability 不自动生成。

## 7. 发布不变量

- User Asset 创建不等于知识生产。
- Candidate、review draft、rejected 项均不能进入 Resolver/Rule Engine。
- 只有 verified Catalog identity、verified care role、verified capability 与 verified evidence 可发布。
- 每一次人工覆盖 AI 候选必须记录原因和审核人。
- Source 缺失、身份冲突、版本不明或 evidence 不足时，默认 `request review`，不默认 approve。

## 审查依据

- `src/schemas/external-product-fact.ts`
- `src/schemas/knowledge-candidate.ts`
- `src/schemas/product-knowledge-review.ts`
- `src/schemas/product-knowledge.ts`
- `src/server/product-facts/knowledge-candidate-file-workflow.ts`
- `src/server/product-facts/product-knowledge-review-file-workflow.ts`
- `src/server/domain/product-knowledge-review/validate-product-knowledge-review.ts`
- `src/server/domain/product-knowledge-review/compile-product-knowledge-seed.ts`
- `src/app/(app)/admin/knowledge/page.tsx`
- `src/features/admin/knowledge-admin-catalog-manager.tsx`
