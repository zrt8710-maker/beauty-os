# PRODUCT KNOWLEDGE ENRICHMENT AGENT V0.1

## 目标与边界

第一个 Enrichment Agent 的唯一职责是：以一个既有 Catalog Product identity 为锚点，收集可追溯资料并生成一个 **candidate knowledge package**。

```text
Catalog Product Identity
  ↓
Source Acquisition
  ↓
Extraction & Normalization
  ↓
Conflict / Confidence Evaluation
  ↓
Candidate Knowledge Package
```

它不创建 Agent 平台、不写数据库、不修改 Resolver/Rule Engine，也不直接发布 verified knowledge。未来真实 AI Provider 只需要实现此输入输出契约。

## 1. 输入契约

```json
{
  "schema_version": "product-knowledge-enrichment-agent/v0.1",
  "catalog_product": {
    "catalog_product_id": "uuid",
    "brand_name": "string",
    "product_name": "string",
    "variant_name": "string | null",
    "barcode": "string | null",
    "category": "string",
    "subcategory": "string",
    "product_type": "string"
  },
  "existing_knowledge_status": {
    "identity": "verified | candidate | unknown",
    "ingredients": "none | candidate | verified",
    "care_roles": "none | candidate | verified",
    "capabilities": "none | candidate | verified"
  },
  "scope": {
    "market": "CN",
    "locale": "zh-CN",
    "allow_user_packaging_images": true
  }
}
```

约束：

- `catalog_product` 是 Agent 的身份锚点，不是模型自行生成的 Catalog 身份。
- `variant_name` 与 `barcode` 缺失时，Agent 必须把版本不确定性写入 `unknown_fields` 或 `conflicts`，不能假定通用版本。
- `existing_knowledge_status` 只用于避免重复采集和决定增量范围；不会让 Agent 覆盖 verified 字段。
- 用户上传包装图片仅是来源之一，必须标记为 `user_packaging_image`，不可自动成为公开事实的唯一依据。

## 2. Source Acquisition

### 来源优先级

| 优先级 | 来源 | 可支持内容 | 限制 |
|---:|---|---|---|
| 1 | 品牌官方产品页 | 身份、variant、产品描述、使用方式、官方定位 | 记录市场、页面版本、获取时间与 URL。 |
| 2 | 官方说明书、包装 PDF、官方成分表 | 身份、原始成分文本、使用方式、注意事项 | 优先于营销页的成分或使用信息。 |
| 3 | 用户上传包装图片 | 包装 OCR、条码、成分文本、版本佐证 | OCR 结果须保留图像/文字定位；不可单独自动发布高影响知识。 |
| 4 | 商业数据源 / 授权零售商 | 补充身份、条码、规格、描述、成分文本 | 需标记商业来源、许可与市场；与官方冲突时不自动裁决。 |
| 5 | 开放数据集 | 补充和发现线索 | 默认弱来源；仅与其他来源交叉验证后使用。 |

Agent 先按优先级采集，再做 cross-source comparison。任何来源均须记录 provider、source type、URL/文档 ID、retrieved_at、locale、market、版权或许可信息。

## 3. Extraction Pipeline

### A. Fact extraction

抽取并标准化：

- brand name
- product name
- variant / capacity
- barcode
- category / product type
- 图片远程引用及其来源/许可

Fact 必须分为：`observed`（原始来源文字）、`normalized`（规范化值）和 `inferred`（模型推断）。只有 observed/normalized 的一致事实可参与后续自动发布判断。

### B. Ingredient extraction

输出两层：

1. `raw_ingredient_text`：不改写的原始标签/页面文本及 source locator。
2. `inci_candidates`：按顺序的标准化 INCI 候选，每项记录原始 token、标准化结果、置信度和解析问题。

AI 不能补全看不清、截断或未找到的成分；必须在 `unknown_fields` 标注缺失。

### C. Understanding extraction

生成候选：

- `product_description`：仅忠实归纳来源描述。
- `usage_information`：部位、时机、频率、使用步骤、官方注意事项。

这些是资料候选，不是医学、功效或安全建议。

### D. Decision candidate extraction

生成：

- `care_role_candidates`：角色、依据、置信度。
- `capability_candidates`：能力、支持/反证 evidence、置信度。

安全规则、禁忌和冲突规则只能输出为 `review_required` observation，不能在 v0.1 中发布为规则。

## 4. Candidate Package 输出 JSON

```json
{
  "schema_version": "product-knowledge-candidate-package/v0.1",
  "package_id": "string",
  "created_at": "ISO-8601",
  "agent": {
    "provider": "future-provider",
    "model": "model-version",
    "run_id": "string"
  },
  "input": {
    "catalog_product_id": "uuid",
    "identity_fingerprint": "brand|name|variant|barcode"
  },
  "sources": [
    {
      "source_id": "string",
      "priority": 1,
      "source_type": "official_brand | official_document | user_packaging_image | commercial | open_dataset",
      "name": "string",
      "url": "string | null",
      "locator": "string | null",
      "market": "CN | null",
      "locale": "zh-CN | null",
      "retrieved_at": "ISO-8601",
      "license_note": "string | null"
    }
  ],
  "facts": {
    "identity": {
      "brand_name": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] },
      "product_name": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] },
      "variant_name": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] },
      "barcode": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] },
      "category": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] },
      "product_type": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] }
    },
    "image_references": []
  },
  "ingredients": {
    "raw_ingredient_text": { "value": "string | null", "evidence": ["source_id"] },
    "inci_candidates": [
      { "raw_token": "string", "inci_name": "string | null", "order": 1, "confidence": 0, "evidence": ["source_id"], "issues": [] }
    ]
  },
  "understanding": {
    "product_description": { "value": "string | null", "confidence": 0, "evidence": ["source_id"] },
    "usage_information": []
  },
  "decision_candidates": {
    "care_roles": [],
    "capabilities": [],
    "safety_observations": []
  },
  "conflicts": [],
  "unknown_fields": [],
  "publication_recommendation": {
    "level_1_facts": "eligible | review_required | blocked",
    "level_2_understanding": "candidate_only",
    "level_3_decision": "review_required"
  }
}
```

每个 `evidence` 必须能追溯到 `sources` 内的 source ID 和 locator。`conflicts` 至少包括字段、冲突值、相关 source、严重度和建议动作。`unknown_fields` 必须说明未能得到结论的原因。

## 5. 自动化规则

### 可自动保存的内容

仅限 Level 1 Fact，且同时满足：

- 与输入 Catalog identity 一致，或有明确的受控更新流程。
- 无 identity/variant/barcode 冲突。
- 来源满足优先级阈值，且字段置信度达到自动发布阈值。
- 图片引用的来源和许可明确。

在当前架构中，“自动保存”应理解为生成可发布的 Fact/Seed 工件，仍经受控 publication gate 写入 Catalog；不能由 Agent 直接写 `catalog_products`。

### 只能作为 candidate 的内容

- 原始成分文本与 INCI interpretation。
- 产品描述与使用信息。
- care role candidate。
- capability candidate 和所有 evidence。
- 安全观察、禁忌、冲突规则。
- 任何低置信度、版本不明、市场不明或来源冲突字段。

## 6. 与现有数据库的关系

| 最终目标 | 可进入的已验证内容 | v0.1 Agent 的处理 |
|---|---|---|
| `catalog_products` | canonical identity、variant、barcode、category/subcategory/product_type、primary source、confidence、verified status | 仅生成 Fact/Seed candidate；受控发布后写入。 |
| `ingredients` | 标准 INCI 词典项 | Agent 输出 INCI candidate；人工/规则确认后才创建或关联。 |
| `catalog_product_ingredients` | 已验证成分关联、顺序、来源、confidence、evidence note | v0.1 只输出 candidate 文件，不直接写入。 |
| `catalog_product_care_roles` | verified 或 candidate role、confidence、source locator | Agent 可输出 role candidate package；只有审核后的 verified role 可影响 Resolver。 |
| `catalog_product_capabilities` | verified/candidate capability | Agent 可输出 capability candidate package；发布需 supporting evidence 通过更严格验证。 |
| `product_capability_evidence` | evidence、direction、review status、confidence | Agent 输出 evidence candidate；不得自动标记 verified。 |

以下内容只作为 candidate package/file：原始成分文本、INCI 解析过程、描述、使用信息、模型信息、冲突、unknown fields、安全观察、候选 capability 的完整推理材料。

## 7. 未来真实 Provider 接入要求

真实 GPT Vision、Gemini Vision 或商业数据 Agent 必须：

- 接受本文件的输入 identity 与 scope。
- 返回同结构 package，不能省略 source、confidence、evidence、conflicts 或 unknown fields。
- 不把模型判断伪装为来源事实。
- 不执行数据库写入、Catalog publication、Resolver 或 Rule Engine 调用。
- 在资料不足时返回 unknown，而不是猜测成分、能力或安全结论。
