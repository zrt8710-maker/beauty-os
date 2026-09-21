# External Product Fact Candidates v0.1

此目录由 `npm run knowledge:fact` 生成外部产品事实文件：

```bash
npm run knowledge:fact -- --barcode 4006381333931
```

文件名为 `<barcode>.facts.json`，Schema 为 `external-product-fact/v0.1`。

这里保存的是外部来源提供的身份、包装标签、远程图片预览地址和 provenance，
不是 Beauty OS verified knowledge。文件不得直接进入 Resolver、Rule Engine 或
`knowledge:seed apply`。

- 不从 category 自动生成 capability。
- 不从 ingredient text 推导安全、风险或肤质适配。
- 不保存外部图片。
- 不保存完整 Provider raw response。
- OBF/AI 内容必须经过未来的人工 Verification 才能形成 Seed。

重复查询同一个 barcode 会更新对应 facts 文件。该目录不得包含用户个人信息或密钥。

## 构建 Knowledge Candidate

把 facts 文件转换为不具备决策效力的候选：

```bash
npm run knowledge:candidate -- \
  --input knowledge-data/product-candidates/4006381333931.facts.json
```

默认输出同目录下的 `4006381333931.candidate.json`，Schema 为
`knowledge-candidate/v0.1`。Builder 只支持小型确定性 category 映射；无法映射或
产生冲突时保持 null 并输出 warning。

Candidate 中的 ingredient 信息只是对 facts 文件 JSON path 的引用；不会解析成分、
生成 risk/capability，也不能直接进入 Seed、Resolver 或 Rule Engine。

## 用户资产自动补充

通过 `owned-products/with-identity` 成功创建的无 Catalog 资产，如果带有有效 barcode，
会在响应发送后 best-effort 获取 External Fact，并在本目录生成：

```text
asset-<owned-product-id>.facts.json
asset-<owned-product-id>.candidate.json
```

Catalog 已关联或没有 barcode 时跳过。Provider/文件失败只记录 enrichment failure，
不会回滚用户资产。重复执行会校验并复用已有的有效文件；如果上次只完成 facts，
重试会继续补齐 candidate。自动生成的 Candidate 仍然没有决策效力，必须继续经过
下面的 Verification Manifest 流程。

## 人工 Verification Manifest

先为 Candidate 生成默认全部未批准的 Review 草稿：

```bash
npm run knowledge:review -- \
  --candidate knowledge-data/product-candidates/4006381333931.candidate.json \
  --prepare
```

默认输出相邻的 `4006381333931.review.json`，Schema 为
`product-knowledge-review/v0.1`。命令拒绝覆盖已存在的 Review，避免丢失人工审核。

人工核对包装和来源后，必须明确确认 identity、product type 和一个 primary role，
并填写 identity/role confidence、role evidence、reviewer 与 reviewed time。v0.1 的
capabilities 必须保持空数组。Review 本身不会写数据库，也不会影响 Resolver。

校验 Review：

```bash
npm run knowledge:review -- \
  --candidate knowledge-data/product-candidates/4006381333931.candidate.json \
  --review knowledge-data/product-candidates/4006381333931.review.json \
  --validate
```

只有校验通过后才可编译为现有 Seed 输入：

```bash
npm run knowledge:review -- \
  --candidate knowledge-data/product-candidates/4006381333931.candidate.json \
  --review knowledge-data/product-candidates/4006381333931.review.json \
  --compile \
  --product-key my-product
```

默认在 `knowledge-data/product-seed/` 生成 `my-product.identity.json` 与
`my-product.knowledge.json`，且拒绝覆盖已有文件。编译只生成文件；仍需独立执行
`knowledge:seed` 的 validate/dry-run/显式 apply 流程。
