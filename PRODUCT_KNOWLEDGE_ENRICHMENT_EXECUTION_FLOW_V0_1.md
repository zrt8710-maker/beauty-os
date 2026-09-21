# PRODUCT KNOWLEDGE ENRICHMENT EXECUTION FLOW V0.1

## 目标

定义 User Asset 创建后的知识补全运行闭环。该闭环只生成和推进候选工件；不阻塞资产创建、不写 verified knowledge、不改变 Resolver 或 Rule Engine。

```text
User Asset Created
  ↓
Knowledge Resolver Check
  ├─ 已有足够 verified knowledge → 直接使用，不触发 Agent
  └─ 缺失/不足 → enrichment suggestion
       ↓
Identity Deduplication
       ↓
Enrichment Agent Run
       ↓
External Fact / Candidate / Review Manifest
       ↓
Published or Review Required
```

## 1. Trigger Design

### 触发条件

Agent 只在以下条件之一满足时触发 suggestion：

1. **新 Catalog Product**：已存在 canonical Catalog identity，但尚无任何已验证知识工件。
2. **已有 Catalog、知识不足**：身份已 verified，但缺少当前目标范围的资料，例如没有已验证成分、护理角色或能力证据。
3. **用户资产关联未知/外部产品**：资产已有用户确认身份，但没有 Catalog 关联；先产生 identity enrichment suggestion，不能直接假设其是新的 Catalog Product。

不触发的情况：

- 该 Catalog Product 已有满足范围的 verified knowledge。
- 同一 identity 已有进行中的 run。
- 最近 run 已以 `not_found` 或 `failed` 结束，且尚未有新来源、新图片、新条码或人工重试请求。
- 资产仅改变开封日期、状态、剩余量、备注等个人信息。

### 触发的职责边界

资产创建只发出 `enrichment_suggested` signal。触发器不抓取、不调用模型、不创建 verified 数据。实际执行可以由后台定时任务、运维脚本或未来队列消费者完成。

## 2. Identity Deduplication

同一产品只应有一个活跃 enrichment identity。归并优先级：

```text
verified barcode exact
  ↓
normalized brand + product name + variant exact
  ↓
人工确认
```

### A. Barcode exact

- 规范化有效条码后完全相同，优先归并到同一 Catalog identity。
- 若条码与品牌/名称冲突，不能自动归并；标记 `conflict` 并进入 review。

### B. Brand + product name + variant exact

- 品牌、产品名称、variant 经过标准化后完全一致，归并到同一 identity key。
- variant 缺失时只能形成较弱的 product-family key，不能与某一容量/版本自动等同。
- 市场、包装更新、限定版或配方版本不明时，保留 version ambiguity。

### C. 人工确认

以下情况必须人工确认：

- 同名不同规格或同系列不同产品。
- 品牌别名、译名、市场名不一致。
- 条码冲突。
- 只有自然语言或图片线索，无法形成稳定 exact key。

### 去重键建议

在不新增数据库的 v0.1 中，用文件路径/任务清单中的 canonical key 去重：

```text
barcode:{normalized_barcode}
或
identity:{normalized_brand}|{normalized_product_name}|{normalized_variant}
```

不满足 exact key 的项放入 `manual-confirmation` 清单，不与已有 run 合并。

## 3. Agent Execution Lifecycle

| 状态 | 含义 | 可进入条件 | 下一步 |
|---|---|---|---|
| `suggested` | 资产或知识检查提出补全需求 | 缺少/不足 verified knowledge | 去重与排程 |
| `collecting` | 正在获取官方页、说明书、包装或商业资料 | 获得唯一 identity key 或允许人工待定采集 | 生成 External Fact |
| `candidate_ready` | 已生成完整 Candidate Package | 至少有可解析事实与来源工件 | 自动门槛评估 |
| `review_required` | 需要人处理 | 冲突、低置信度、版本不确定、Level 3 或安全项 | Admin approve/reject/request review |
| `published` | 已通过既有 publication gate | review/自动 Level 1 发布完成，verified 数据可读 | 结束 |
| `not_found` | 未找到足够资料 | 可信来源均无结果 | 等待新线索/人工重试 |
| `failed` | 运行技术失败 | Provider、解析、文件或网络错误 | 有限重试后等待重试 |
| `rejected` | 审核确认不可发布 | 错误身份、来源不可信或冲突无法解决 | 结束，保留原因 |

状态转换不应隐式把 `candidate_ready` 变成 `published`。即使 Level 1 自动化达标，也必须通过受控 Fact/Seed publication gate；Level 2/3 默认进入 `review_required`。

## 4. Candidate Storage Strategy（不新增数据库）

使用现有文件工件作为 v0.1 的 durable boundary：

```text
knowledge-data/product-candidates/
  {identity-key}.facts.json
  {identity-key}.candidate.json
  {identity-key}.review.json

knowledge-data/product-seed/
  {product-key}.identity.json
  {product-key}.knowledge.json
```

### External Fact

保存原始可追溯事实：身份、条码、原始成分文本、外部分类、图片远程引用、来源、获取时间和 warning。它是候选的输入证据，不是 verified knowledge。

### Knowledge Candidate

保存标准化身份、分类、primary role 等候选与 warning。v0.1 中可在 package 附加理解层和决策层候选工件，但这些扩展字段不应直接喂给现有 curation RPC。

### Review Manifest

保存人工确认：身份、分类、primary role、来源、审核人和审核时间。只有 validate 通过后，才能 compile 为 identity/knowledge seed。

### 文件写入规则

- 使用 identity key 作为文件前缀；同 key 不覆盖已有事实或审核记录。
- 新资料写入新 revision 或 `review_required` 附件，不覆盖已审核版本。
- 事实、候选、review 的引用必须包含 fact ID/file name，避免串错产品。
- 文件系统是 v0.1 工件仓库，不是长期高并发任务队列。

## 5. Knowledge Layer Separation

| 层 | 包含内容 | 可写入位置 | 是否可进入决策 |
|---|---|---|---|
| Fact Candidate | 品牌、名称、variant、barcode、分类、图片引用、来源 | External Fact / Candidate Package | 否；通过发布后可成为 Catalog fact |
| Understanding Candidate | 原始成分文本、INCI 解析、描述、使用信息 | Candidate Package/附件文件 | 否 |
| Decision Candidate | care role、capability、evidence、安全观察、冲突规则 | Candidate Package/Review Manifest | 否；仅 verified role/capability/evidence 可进入决策 |

基础 product type 在 verified 前只能作为候选或用户资产 fallback 线索；不得由 Agent 自动推导 capability 或安全结论。

## 6. Failure Handling

### 找不到资料

- 状态：`not_found`。
- 保留已查询来源和时间，防止每个资产重复运行。
- 不创建空 Catalog knowledge；资产继续可用，Resolver 使用现有 fallback。
- 新条码、用户包装图、官方来源或人工重试才重新建议运行。

### 来源冲突

- 状态：`review_required`。
- 将冲突字段、各值、来源、市场/日期和严重度写入 Candidate Package。
- 条码、名称、variant 冲突阻止 identity publication。
- capability/安全冲突阻止 Level 3 publication。

### 产品版本不确定

- 状态：通常为 `review_required`。
- 保留 product-family identity，不合并到某个具体 variant。
- 不把一个版本的成分或能力套用到另一个版本。

### AI/Provider 失败

- 状态：`failed`，记录 provider、失败阶段、错误码和时间。
- 使用有上限的指数退避重试；超过上限后等待新触发条件或人工重试。
- 不以模型失败为理由降级写入猜测的 facts。

## 7. Future Migration Path

### 何时需要 `knowledge_jobs`

出现以下任一情况时：

- 有定时/并发 Agent worker，需要锁、重试、优先级和死信处理。
- `suggested` 不能再靠文件清单或日志可靠地追踪。
- 需要按关联资产数量、风险和等待时间排序。

`knowledge_jobs` 应管理 identity key、状态、尝试次数、优先级、错误与去重锁。

### 何时需要 `knowledge_runs`

出现以下任一情况时：

- 需要记录多次来源采集或多个 Provider 的运行历史。
- 需要追踪模型/provider 版本、输入、成本、时间、失败阶段。
- 需要可重放、比较或审计 Agent 输出。

`knowledge_runs` 应管理一次执行的输入快照、provider/model、开始/结束时间、结果工件引用和错误。

### 何时需要 `knowledge_candidates`

出现以下任一情况时：

- Candidate 要被 Admin UI 查询、筛选、多人协作审核或字段级比较。
- 需要结构化 INCI candidate、描述、使用信息、冲突和审核历史。
- 文件工件开始成为性能、权限、检索或并发瓶颈。

`knowledge_candidates` 应保存版本化 candidate payload、aggregate confidence、conflict summary、来源引用和 review 状态；不要在第一次迁移就把所有 Agent 细节拆成多张表。

## v0.1 不变量

- 同一 canonical identity 同时最多一个 active run。
- User Asset 创建永不等待 enrichment。
- Candidate、not_found、failed、rejected 均不进入 Resolver/Rule Engine。
- 文件工件不可静默覆盖。
- 只有 verified publication 才改变 Product Knowledge 的决策可见数据。
