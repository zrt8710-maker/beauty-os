# PRODUCT KNOWLEDGE SOURCE ACQUISITION V0.1

## 目标与边界

Source Acquisition Layer 将一个已存在的 Catalog Product identity 转化为可追溯的 **External Fact Package**。它只采集和保存来源中的原始事实；不规范化为 verified knowledge，不写数据库，也不影响 Resolver、Rule Engine 或今日方案。

```text
Catalog Product Identity
  ↓
Source Acquisition
  ↓
External Fact Package
  ↓
Candidate Generator
  ↓
Knowledge Candidate Package
```

它与 Candidate Generator 的职责不同：采集层负责“来源写了什么”，生成器负责明确标注“哪些是观察事实、哪些尚未知、哪些仅可作为候选”。

## 1. 输入与 Provider 接口

### Acquisition input

```ts
type SourceAcquisitionInput = {
  catalog_product: {
    catalog_product_id: string;
    brand_name: string;
    product_name: string;
    variant_name: string | null;
    barcode: string | null;
    category: string | null;
    product_type: string | null;
  };
  scope: {
    market: string;
    locale: string;
    allowed_source_types: SourceType[];
  };
};

type SourceType =
  | "official_website"
  | "brand_material"
  | "authorized_retailer"
  | "commercial_database"
  | "user_packaging_image"
  | "community";
```

Catalog identity 是检索锚点，不授权 Provider 修改 Catalog identity。若来源的名称、variant 或条码不一致，Provider 返回原文及 warning；后续 Conflict Detection 处理，不能在 Provider 内自行覆盖。

### Provider interface

```ts
type SourceProvider = {
  provider_code: string;
  source_type: SourceType;
  collect(input: SourceAcquisitionInput): Promise<SourceProviderResult>;
};

type SourceProviderResult = {
  provider_code: string;
  status: "found" | "not_found" | "failed";
  facts: RawExternalFact[];
  warnings: SourceWarning[];
};
```

约束：

- Provider 可返回零至多个 `RawExternalFact`，每一条都必须保留独立 source reference。
- `not_found` 不代表产品不存在，只表示当前 Provider 没有可用资料。
- `failed` 必须有结构化 warning；其他 Provider 仍可继续。
- 用户包装图片 Provider 只提取图片或 OCR 可观察内容，不能将 OCR 解析为成分、功效或安全结论。
- 任何 Provider 都不得调用 Candidate publication、Resolver、Rule Engine 或数据库写入接口。

## 2. External Fact Package

每次 acquisition 输出一个不可变的外部事实包。建议保存为离线 JSON 工件，例如：

```text
knowledge-data/external-facts/<identity-fingerprint>/<run-id>/external-facts.json
```

`run-id` 是采集批次，避免新采集覆盖旧证据；未来再决定是否持久化为表。

```json
{
  "schema_version": "external-product-fact-package/v0.1",
  "package_id": "string",
  "collected_at": "ISO-8601",
  "input_identity": {
    "catalog_product_id": "uuid",
    "brand_name": "string",
    "product_name": "string",
    "variant_name": "string | null",
    "barcode": "string | null"
  },
  "facts": [
    {
      "fact_id": "string",
      "source": {
        "provider_code": "string",
        "source_type": "official_website",
        "source_name": "string",
        "source_url": "https://example.com/product",
        "locator": "page section, PDF page, image region, or record id",
        "market": "CN | null",
        "locale": "zh-CN | null",
        "collected_at": "ISO-8601",
        "license_note": "string | null"
      },
      "raw_identity": {
        "brand_name": "string | null",
        "product_name": "string | null",
        "variant_name": "string | null",
        "barcode": "string | null",
        "quantity": "string | null"
      },
      "raw_description": "string | null",
      "raw_ingredient_text": "string | null",
      "raw_usage_text": "string | null",
      "image_references": [
        { "url": "string", "kind": "front | label | ingredient_label | other", "license_note": "string | null" }
      ],
      "warnings": []
    }
  ],
  "conflicts": [],
  "warnings": []
}
```

`raw_*` 是原样获取的文本，不能被模型改写。OCR 可作为 `raw_*` 的来源，但必须在 `locator` 中标明图片与文字区域，并在 warning 中说明可读性或截断风险。

现有 [`external-product-fact.ts`](src/schemas/external-product-fact.ts) 可复用其 source、warning、原始 identity、成分文本与图片 URL 的表达方式；它目前仅面向条码和开放数据集，不能直接覆盖多 Provider、描述、usage、冲突或包装图片。因此 v0.1 采用上述 package 契约，而不修改现有 schema 或数据库。

## 3. 来源优先级

| 优先级 | 来源类型 | 适合采集 | 使用限制 |
|---:|---|---|---|
| 1 | 官方网站 / 官方产品页 | 身份、variant、官方描述、使用信息、官方图片 | 保留市场和页面 URL；不是成分唯一真相。 |
| 2 | 品牌资料 / 官方说明书 / 包装 PDF | 身份、原始成分文本、usage、注意文字 | 成分与包装信息优先看此层。 |
| 3 | 授权零售 | 规格、条码、产品描述、补充成分文本 | 仅在品牌资料缺失或交叉验证时使用。 |
| 4 | 商业数据库 | 补充身份、规格、条码、图片、描述 | 必须记录许可、市场与数据更新时间。 |
| 5 | 用户包装图片 | 条码、包装文字、成分标签、版本佐证 | OCR 可能不完整；不能单独自动发布高影响结论。 |
| 6 | 社区资料 | 发现线索、过期产品页的辅助线索 | 默认弱来源，不能单独支持身份变更、成分或决策知识。 |

同级来源不自动互相覆盖。采集层只记录优先级，发布资格由后续 Candidate/Review 流程判断。

## 4. Conflict Detection

采集完成后，按 identity field 和原始成分文本比较所有同一 identity fingerprint 下的 facts，输出 `conflicts`。冲突不是错误，也不丢弃任一来源。

```json
{
  "conflict_id": "string",
  "field": "product_name | variant_name | barcode | raw_ingredient_text",
  "severity": "blocking | review_required | informational",
  "values": [
    { "value": "string", "fact_id": "string", "source_id": "string", "priority": 1 }
  ],
  "reason": "string",
  "recommended_action": "keep_unknown | request_variant_confirmation | request_manual_review"
}
```

规则：

| 冲突 | 严重度 | 处理 |
|---|---|---|
| 产品名称核心词不同 | `review_required` | 保留全部原文；不更新 canonical identity。 |
| variant / 容量不同 | `blocking` | 视为可能不同 SKU；不合并成分或 Candidate。 |
| 同一条码对应不同名称或 variant | `blocking` | 停止自动链路，要求人工核验来源或条码。 |
| 原始成分文本不同 | `review_required` | 可能是版本、市场或配方更新；禁止合并或选择一方作为 verified。 |
| 描述/usage 文案不同 | `informational` 或 `review_required` | 标记市场/版本差异；仅保留对应来源的原文。 |

来源优先级可帮助排序人工复核，但不能在采集层把低优先级事实静默删除。资料不足、版本不明或 OCR 不完整时，输出 warning 和 unknown，而不是推测。

## 5. 与 Candidate Generator 的集成

```text
1. Catalog identity 作为 acquisition 输入
2. Source Providers 返回 RawExternalFact
3. Aggregator 形成 External Fact Package 并检测冲突
4. Candidate Generator 读取 identity + External Fact Package
5. Generator 将来源文字标记为 observed fact，将任何解释标记为 candidate inference
6. 输出 Knowledge Candidate Package，等待独立 publication/review
```

v0.1 的现有离线 Candidate Generator 只接受 identity，并显式把成分、理解和决策字段标为 unknown。接入本层后，它可以扩展为读取 External Fact Package，但必须遵守：

- `raw_ingredient_text`、description、usage 先作为附带 source 的 observed material，不能直接变成 verified knowledge。
- INCI 解析、care role、capability 与安全结论都是 `candidate_inference`，必须含 source evidence、confidence、unknown fields 和 conflicts。
- 有 `blocking` conflict 时，相关字段只能保留 unknown/candidate，不能推荐发布。

## 6. 明确禁止项

Source Acquisition Layer 及其未来 Provider 不得：

- 写入 `catalog_products`；
- 写入 `ingredients` 或任何 verified ingredient relation；
- 写入 verified capability、care role 或 safety rule；
- 调用 Resolver 或 Rule Engine；
- 改变用户资产、今日方案或资产可用性；
- 因为没有找到来源而把未知产品误标为错误身份。

因此即使 acquisition 全部失败，用户资产仍按 Identity-first flow 存在，并继续使用既有的 verified knowledge 或 product-type fallback。

## 7. v0.1 实施边界与下一步

本阶段只冻结接口与离线工件格式，不接入商业 API、不抓取网站、不做数据库 migration。首个实现可以从 deterministic mock Provider 开始，覆盖：`found`、`not_found`、Provider failure、variant conflict 和 ingredient conflict。

在真实 Provider 接入前，应新增契约测试，确保每个 result 都有 source、collected time、warnings；并验证带 conflict 的 package 不会越过 Candidate Generator 进入 verified publication 或决策运行时。
