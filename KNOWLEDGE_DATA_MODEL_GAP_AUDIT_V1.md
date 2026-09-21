# KNOWLEDGE DATA MODEL GAP AUDIT V1

## 结论

当前模型足以承载“人工/文件驱动的 verified Product Knowledge”，并已具备 Decision Layer 的 candidate、verified、confidence 与 capability evidence 基础。

但它**尚不能完整承载持续运行的 AI 自动知识补全**：Fact 与 Understanding 的多数内容只存在于离线文件 Schema，缺少可查询、可去重、可审计的数据库载体；AI 运行元数据、冲突记录和完整人工审核历史也未持久化。

不建议在当前阶段直接建设复杂 Agent 平台。v1 可以复用现有文件工作流完成小规模试运行；当需要自动任务队列、跨资产去重和例外审核时，再引入最小持久化工作项模型。

## 1. Fact Layer

| 能力 | 当前载体 | 状态 | 说明 |
|---|---|---|---|
| 品牌、产品名 | `catalog_products`、`products`、External Fact | 支持 | Catalog 可保存 canonical verified identity；用户产品为个人资产身份。 |
| variant | `catalog_products.variant_name`、`products.variant_name`、External Fact | 支持 | 可表达版本/容量文字。 |
| barcode | `catalog_products.barcode`、`products.barcode`、External Fact | 支持 | Catalog barcode 唯一。 |
| 基础分类 | Catalog category/subcategory/product_type | 支持 | 可作为 verified 事实与 fallback 输入。 |
| 来源 | `knowledge_sources`、External Fact source | 部分支持 | DB 有来源类型、名称、URL、许可、retrieved_at；External Fact 另有 provider_code/raw_record_id/quality。两者未形成完整的字段级 provenance 链。 |
| 图片引用 | External Fact `media.image_front_url` | 部分支持 | 只在文件事实 Schema 中存在，明确 `stored: false`；Catalog/Product Knowledge 数据库没有产品图片引用或版权/来源关联。 |

### Fact Layer 结论

身份、variant、barcode 和分类可以复用现有 Catalog Schema。图片引用和更完整的来源 provenance 不能直接进入现有数据库；当前只能作为 External Fact 文件的一部分。

## 2. Understanding Layer

| 能力 | 当前载体 | 状态 | 缺口 |
|---|---|---|---|
| 原始成分文本 | `ExternalProductFact.label.ingredients_text` | 仅文件支持 | 未持久化到数据库，无法按产品检索或比较版本。 |
| 已验证 INCI 关系 | `ingredients` + `catalog_product_ingredients` | 支持 | 可保存 verified ingredient、顺序、来源、confidence、evidence note。 |
| INCI 解析 candidate | `KnowledgeCandidate.input_fact.ingredients_text_reference` | 不支持 | 只指向原始文本，没有 token、标准化结果、解析置信度、顺序或错误项。 |
| 成分 candidate/review 状态 | 无 | 不支持 | `catalog_product_ingredients` 没有 candidate/rejected/review 状态。 |
| 产品描述 candidate | 无 | 不支持 | 无描述正文、摘要、来源定位或置信度模型。 |
| 使用信息 candidate | 无 | 不支持 | 无频率、步骤、适用区域、注意事项或来源字段。 |

### Understanding Layer 结论

现有 verified ingredient 模型可复用为最终发布目标，但不能作为 AI candidate 工作区。直接把 AI 解析写入 `catalog_product_ingredients` 会混淆 candidate 与 verified 边界，不建议这样做。

## 3. Decision Layer

| 能力 | 当前载体 | 状态 | 说明 |
|---|---|---|---|
| care role candidate | `catalog_product_care_roles.status` | 支持 | 状态为 candidate/verified/unknown，有 confidence、note、source locator、reviewed_at。 |
| capability candidate | `catalog_product_capabilities.status` | 支持 | 状态为 candidate/verified/unknown，有 confidence、note、reviewed_at。 |
| capability evidence | `product_capability_evidence` | 支持 | 支持 supports/contradicts、source locator、confidence、candidate/verified/rejected。 |
| care role evidence | source locator / note | 部分支持 | 无独立、可多条审核的 role evidence 表。 |
| review state | status + reviewed_at | 部分支持 | 可表达发布状态，但没有 request-review、reject reason、review owner 或状态迁移历史。 |
| Resolver 隔离 | Resolver 仅使用 verified | 支持 | candidate role/capability 不会进入决策；可保留 product type fallback。 |

### Decision Layer 结论

Decision Layer 是最接近 Agent Pipeline 需求的部分，可直接复用 candidate/verified/evidence 模型。v1 的主要缺口不是新的 capability 表，而是候选生产 provenance 和审核历史。

## 4. AI Pipeline 元数据审计

| 元数据 | 当前支持 | 缺口 |
|---|---|---|
| Source provenance | 部分 | DB source 缺 provider_code/raw record/字段定位；External Fact 有这些信息但为文件。 |
| Extraction time | 部分 | 有 source retrieved_at；没有 Agent extraction_at、处理批次、字段生成时间。 |
| Confidence | 部分 | Catalog、ingredient、role、capability 与 evidence 支持 confidence；描述/使用/INCI candidate 不支持。 |
| Conflict | 部分 | External Fact issues 与 Knowledge Candidate warnings 可表达文件级 warning；没有持久化 conflict entity、冲突字段、候选双方与解决记录。 |
| Model/provider information | 不支持 | `knowledge_sources.source_type = ai_candidate` 过于粗粒度；无模型名、版本、prompt/template、运行 ID、参数或输入引用。 |
| Human review history | 不支持 | 有 reviewed_at、reviewed_by（Review Manifest）和 note，但无不可变审核动作、reject/request-review 原因或历史。 |
| Job/task 状态 | 不支持 | 当前 `enrichment_suggested` 是运行时 signal，不是可查询的后台工作项。 |

## 5. 可复用的现有 Schema

无需替换的部分：

- `knowledge_sources`：verified publication 的来源主记录。
- `catalog_products`：verified canonical identity 与基础分类。
- `ingredients`、`catalog_product_ingredients`：verified INCI 发布目标。
- `catalog_product_care_roles`：role candidate/verified 状态。
- `catalog_product_capabilities`、`product_capability_evidence`：capability candidate/verified 与证据。
- `ExternalProductFact`：原始外部事实交换格式。
- `KnowledgeCandidate`、`ProductKnowledgeReview`：离线 candidate/review 文件工作流。
- 现有 curation RPC：verified publication gate。

## 6. 是否需要新增表

### 当前阶段：不需要

如果 v1 仅做受控、小批量、文件驱动的 Agent 试运行，可以复用：

```text
External Fact file
→ Knowledge Candidate file
→ Review Manifest file
→ compile seed
→ existing curator apply
```

此模式不适合高并发或大量资产，但无需修改数据库，且能保持 verified publication gate。

### 进入自动化运营时：需要最小新增持久化

当需要“自动任务队列 + 异常审核 + 跨资产去重”时，建议新增**一个**最小工作项/候选工件表，而不是立刻拆分多张 Agent 专用表。

该工作项应至少持有：

- canonical identity key / 可选 Catalog ID。
- 任务状态：suggested、collecting、candidate_ready、review_required、published、rejected、failed。
- 原始事实与 candidate payload 的引用或 JSON 工件。
- source/provider/model/extraction 时间。
- aggregate confidence、conflict summary、最后错误。
- reviewer、最后动作、最后时间与备注。

结构化 INCI candidate、描述/使用信息版本和完整审核事件，只有在这些内容开始被产品化展示、查询或多人协作审核时，再从该最小工作项中拆出专用表。

## 7. v1 最小实现建议

1. 保持现有数据库不变，先把 Agent 输出限制为 External Fact、Knowledge Candidate、Review Manifest 文件。
2. 将 `enrichment_suggested` 聚合为文件/运维任务清单，按 canonical identity 去重。
3. Level 1 仅走现有 Catalog Seed + curation 发布闸门；不要直接由 Agent 写 Catalog。
4. Level 2 成分、描述、使用信息仅保留为候选工件，不写 verified ingredient relation。
5. Level 3 优先复用 care role、capability、evidence 的 candidate 状态；继续由 Resolver 过滤 verified。
6. 先记录 provider、模型版本、抽取时间、来源 URL、字段 confidence 与 conflict summary 到候选工件中；这是未来迁移到数据库时最关键的兼容数据。

## 8. 不应做的事情

- 不要把原始 AI 输出直接写入 `catalog_products`、`catalog_product_ingredients` 或 verified capability。
- 不要把 `knowledge_sources.ai_candidate` 当作充分 provenance；仍需原始来源与字段定位。
- 不要为了任务队列先建设多个高度规范化 Agent 表。
- 不要让 candidate ingredient、candidate capability 或未解决 conflict 进入 Resolver/Rule Engine。

## 审计依据

- `supabase/migrations/20260818070000_create_product_knowledge.sql`
- `supabase/migrations/20260820001000_create_product_capability_foundation.sql`
- `supabase/migrations/20260822000000_create_product_care_role_foundation.sql`
- `supabase/migrations/20260824000000_create_product_knowledge_curation_rpc.sql`
- `src/schemas/external-product-fact.ts`
- `src/schemas/knowledge-candidate.ts`
- `src/schemas/product-knowledge-review.ts`
- `src/schemas/product-knowledge-curation.ts`
