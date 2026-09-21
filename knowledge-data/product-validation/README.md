# Product Knowledge Runtime Validation v0.1

这个目录记录少量真实产品的运行时闭环验证说明，不保存批量产品数据。

## 运行命令

Catalog Product 和 verified knowledge 已经 apply 后，执行：

```bash
npm run knowledge:runtime -- \
  --catalog-product-id <uuid> \
  --period am \
  --scenario dryness \
  --external-facts
```

可选场景：`baseline`、`dryness`、`sensitivity`、`oiliness`、`high-uv`。
增加 `--json` 可输出机器可读报告。该命令是只读工具，不写 Catalog、Product
Knowledge、用户资产或方案记录。

报告依次展示：

1. Catalog 产品身份。
2. 可选的 Open Beauty Facts 外部事实摘要。
3. verified/candidate/unknown 知识状态。
4. ProductDecisionProfile。
5. Rule Engine 实际可见角色、eligibility、评分构成和 fallback 差异。
6. verified capability 与 DailyCareNeeds priority 的匹配及加分。

## 首批四个真实产品门槛

每个 cleanser、moisturizer、treatment、sunscreen 都必须先具备：

- 用户确实拥有该产品；
- 包装可确认的正式品牌、名称、variant 和 barcode；
- 官方产品页或包装作为 identity/role 证据；
- facts → candidate → review → seed 文件链；
- Seed validate、dry-run、显式 apply 后的 runtime report。

缺少包装或 barcode 时不得根据产品简称猜版本，也不得创建 verified Seed。

## 当前环境审计（2026-08-25）

- 远程 `catalog_products` 为空。
- 远程数据库尚未应用 Product Identity Persistence v0.2 migration。
- 现有真实资产没有可读取的 variant/barcode。
- 现有资产不足以可靠覆盖 cleanser、moisturizer、treatment、sunscreen 四类。

因此本目录暂不包含伪造的“真实 Seed”。获得四件产品的包装照片或 barcode 后，
继续使用现有 `knowledge:fact`、`knowledge:candidate`、`knowledge:review` 和
`knowledge:seed` 命令生成并审核真实文件。
