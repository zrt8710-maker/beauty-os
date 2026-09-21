# Product Knowledge Curation Data v0.1

此目录用于保存经过人工审核的 Product Knowledge Curation JSON。它是小规模知识整理的数据源，不是数据库 migration、批量抓取目录或 AI 生成结果目录。

## 目录和命名

- 一个 JSON 文件只描述一个 `catalog_product_id`。
- 文件名使用 `<catalog_product_id>.json`，避免品牌昵称或产品改名造成身份漂移。
- JSON 必须使用 `product-knowledge-curation/v0.1` schema。
- 文件应纳入版本控制，但不得包含密钥、用户数据或未授权的大段原文。
- 产品官方说明应保存为人工摘要，并在 `source_locator` 中记录来源位置。

```text
knowledge-data/product-knowledge/
  README.md
  10000000-0000-4000-8000-000000000001.json
```

## 文件结构

```json
{
  "schema_version": "product-knowledge-curation/v0.1",
  "catalog_product_id": "10000000-0000-4000-8000-000000000001",
  "roles": [
    {
      "care_role_code": "moisturizer",
      "assignment_kind": "primary",
      "status": "verified",
      "confidence": 95,
      "assessment_note": "人工审核摘要",
      "source_locator": "https://example.com/official-product",
      "reviewed_at": "2026-08-24T00:00:00.000Z"
    }
  ],
  "capabilities": [
    {
      "capability_code": "hydration",
      "status": "verified",
      "confidence": 90,
      "assessment_note": "人工审核结论",
      "reviewed_at": "2026-08-24T00:00:00.000Z",
      "evidence": [
        {
          "evidence_type": "official_product_description",
          "direction": "supports",
          "evidence_note": "官方资料支持补水用途",
          "source_locator": "https://example.com/official-product",
          "confidence": 90,
          "review_status": "verified"
        }
      ]
    }
  ]
}
```

## 变更语义

- `roles` 和 `capabilities` 只声明本次需要 create/update/确认 unchanged 的项目。
- 未声明的 role 和 capability 保持不变；省略不表示删除。
- 每个已声明 capability 的 `evidence` 是完整集合：apply 时采用 replace 语义。
- evidence 的语义内容完全相同时，Runner 报告 `unchanged`；否则报告 `replace`。
- role 不推导 capability，capability 也不推导 role。
- v0.1 不支持删除、批量导入、AI 生成或外部数据库同步。

## 安全执行顺序

1. 先以默认 `dry-run` 模式运行 Import Runner。
2. 审核 identity、warnings，以及 role/capability/evidence changes。
3. 确认目标产品和 diff 正确后，再显式使用 `apply` 模式。
4. Schema、Validator、preview 或 apply 任一阶段失败时，使用报告中的 `errors` 修正文件。

Runner 只调用 `ProductKnowledgeCurationService`。它不会直接访问 Repository、Supabase 或数据库，也不单独提供命令行、API 或 UI 入口。

新的端到端 Identity + Decision Knowledge 录入应使用
[`knowledge-data/product-seed`](../product-seed) 中的成对文件和
`npm run knowledge:seed`。该 workflow 在内部复用本 Runner；本目录保留为
curation-only 数据与底层 Runner 的说明。
