# Product Knowledge Seed Workflow v0.1

本目录保存已经人工核验、准备发布到 Beauty OS 本地知识库的产品 Seed。它不是外部 Provider 缓存、抓取结果目录或 AI 输出目录。

## 文件配对

每个产品使用稳定的 `product-key` 保存两个文件：

```text
<product-key>.identity.json
<product-key>.knowledge.json
```

两个文件的 `catalog_product_id` 必须相同。`product-key` 只允许小写字母、数字和连字符，不作为数据库身份。

- identity 文件直接使用现有 `catalog-seed/v0.1` Schema。
- knowledge 文件直接使用现有 `product-knowledge-curation/v0.1` Schema。
- 每个 Seed 必须且只能有一个 `verified` primary role。
- `verified` capability 必须至少有一条 `verified`、`supports` evidence。
- OBF、其他开放数据和 AI 只能用于准备候选；写入本目录前必须人工核验。
- `ai_candidate` 不能作为 verified identity 的来源，现有 Catalog Validator 会拒绝。

从 External Fact / Knowledge Candidate 进入本目录时，使用
`knowledge:review --validate` 和 `knowledge:review --compile`。Compiler 只接受通过
`product-knowledge-review/v0.1` Gate 的 Candidate，并且 v0.1 永远输出空 capability；
它不会执行数据库 apply，也不会覆盖本目录已有 Seed。

可复制的示例位于 [`templates`](./templates)。示例不属于实际 Seed，不会被批量命令扫描。
先把两个模板复制到本目录并替换为同一个真实产品的人工核验信息，再执行下面的命令。

## 命令

纯文件和领域校验，不连接数据库：

```bash
npm run knowledge:seed -- --validate
```

默认模式为 dry-run。它会执行 Catalog 冲突检查；如果 Catalog 已存在，还会输出 role、capability 和 evidence diff：

```bash
npm run knowledge:seed
npm run knowledge:seed -- --product my-product
```

新 Catalog 尚未写入时，dry-run 报告的 knowledge 状态为 `preview_deferred`。这是因为现有 Curation Service 只允许针对已存在的 verified Catalog 生成数据库 diff。

显式 apply 需要二次确认字符串：

```bash
npm run knowledge:seed -- --product my-product --apply --confirm APPLY_VERIFIED_KNOWLEDGE
```

apply 严格按以下顺序执行：

1. Catalog preflight。
2. Catalog Seed Service 原子写入和回读。
3. Product Knowledge Curation preview。
4. Curation RPC 原子写入和回读。

Workflow 不直接访问表，也不绕过现有 Service/Repository/RPC。如果 Identity 已提交但 Knowledge 阶段失败，报告会保留该状态；修正 knowledge 文件后重新执行相同命令即可幂等补齐。

## 首批产品

不要创建占位产品或批量导入外部数据。首批选择 6–10 件真实、正在使用且会影响今日方案的产品：清洁、保湿、防晒和实际使用的 treatment 优先。

每个产品的最低完成标准：

1. 准确核对包装、名称、variant 和条码。
2. identity 为 verified，并记录可追溯来源。
3. knowledge 有一个 verified primary role。
4. capability 只在证据充分时填写。
5. apply 后用 Resolver/Rule Engine 场景测试验证行为变化。
