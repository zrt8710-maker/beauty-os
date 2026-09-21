# PRODUCT KNOWLEDGE AGENT PIPELINE V1

## 目标与边界

本流程让 AI 自动处理绝大多数资料收集、抽取、归一化和质量评估工作；管理员只处理冲突、低置信度和高影响决策知识。

AI 不得直接影响 User Asset 创建、Recognition 身份确认、Rule Engine 或 Resolver。任何自动发布都必须是可追溯的事实发布，而不是由模型自行生成的护理、安全或能力结论。

## 1. 知识等级

| 等级 | 内容 | 默认处理 | 是否可进入决策 |
|---|---|---|---|
| Level 1：自动发布事实 | 品牌、产品名、variant、条码、图片引用、基础分类 | 满足来源与一致性阈值后自动发布 | 否；基础分类只可作为现有 product type fallback 的输入 |
| Level 2：AI 候选知识 | 成分解析、产品描述、使用信息 | 保存为 candidate，并标注字段置信度、来源与冲突 | 否 |
| Level 3：决策影响知识 | care role、capability、安全规则、冲突规则 | 默认 candidate；进入更严格验证 | 仅 verified 后可进入 Resolver/Rule Engine |

### Level 1：自动发布事实

可自动发布的前提不是“AI 很自信”，而是以下机器可审计条件全部满足：

- 可识别的来源，且来源等级达到配置阈值。
- 身份字段之间无冲突；条码、品牌、名称、variant 的关系一致。
- 至少一个高权威来源，或两个独立的中等权威来源相互一致。
- 字段级置信度达到阈值，且没有市场/版本不明警告。
- 图片只保存允许展示的远程引用、权利信息和来源；不将未知版权图片自动复制入库。

基础分类可自动发布为低影响的 `product_type` 事实，仅用于资产分组和现有 fallback。分类不能自动推出 capability、护理角色或安全结论。

### Level 2：AI 候选知识

Level 2 的每个字段必须附带：

- 原始文本或原始页面定位。
- 来源 URL、来源类型、抓取时间、适用市场/版本。
- 抽取方法与字段置信度。
- 冲突、缺失和不确定性标记。

成分必须保留原始 INCI/标签文本与解析候选的对应关系。AI 可以把“ingredients text”拆分为 INCI candidate，但不能把无法读取、顺序不明或来源不可靠的内容伪装成完整成分表。

产品描述与使用信息可以自动呈现为“资料候选”，但不得转译为功效承诺、安全建议或方案指令。

### Level 3：决策影响知识

Level 3 必须使用字段级 evidence gate：

- care role：需要产品用途、类型和可定位来源支持。
- capability：需要明确的支持性证据；营销词本身不足以发布 capability。
- safety rule：不得由普通 Agent 自动发布；需要更高权威来源、专门规则与人工/专家复核策略。
- conflict rule：可以自动发现冲突并阻止发布，但不能自动选择一方为真。

只有 `verified` Level 3 知识可以覆盖 Resolver fallback 或进入 Rule Engine。candidate、rejected、资料不完整和冲突项一律不可用。

## 2. Knowledge Agent 流程

```text
User Asset Created
  ↓
Knowledge Agent Trigger
  ↓
Source Collection
  ↓
Extraction & Normalization
  ↓
Cross-source Conflict Detection
  ↓
Confidence Evaluation
  ├─ Level 1 gate passed → 自动发布事实
  ├─ Level 2 → 保存 candidate knowledge
  └─ Level 3 / 低置信度 / 冲突 → Review Queue
```

### A. Trigger

User Asset Created 只产生 `enrichment_suggested` 信号。Agent 可异步、可重试地消费该信号；失败、延迟或没有资料都不影响资产创建和今日方案 fallback。

同一 canonical identity 应被去重为一个 enrichment job，而不是每个用户资产重复采集。

### B. Source Collection

按来源可靠性和成本排序：

1. 品牌官方页面、官方说明书、官方标签。
2. 官方授权零售商。
3. 公开数据集。
4. 用户提供的包装文字或图片，仅作弱证据。

Agent 必须记录获取时间、市场、语言、版本和许可。无法定位到具体产品/variant 的资料只能作为候选，不能做 Level 1 发布依据。

### C. Extraction & Normalization

Agent 执行：

- OCR/页面文本抽取。
- 身份字段标准化与 variant 归并。
- 条码格式校验。
- 原始成分文本保存与 INCI candidate 解析。
- 基础分类候选。
- 使用信息与产品描述的结构化候选。
- care role、capability、冲突的候选及证据链接。

Agent 输出必须区分 `observed fact`、`normalized value` 和 `inference`；不得把推断写成观察到的事实。

### D. Confidence Evaluation

置信度由可解释规则计算，而非仅使用模型自报分数：

```text
field confidence
= source authority
+ identity/variant consistency
+ cross-source agreement
+ extraction quality
- conflict severity
- stale or market-mismatch penalty
```

建议阈值：

| 结果 | 条件 |
|---|---|
| 自动发布 Level 1 | 无冲突、强来源或多来源一致、字段置信度 ≥ 90 |
| 高质量 Level 2 candidate | 字段置信度 70–89，或来源完整但仍需成分/描述核验 |
| Review Queue | 置信度 < 70、identity/variant/source 冲突、Level 3、任何安全相关项 |
| Reject / no publish | 来源不可验证、内容互相矛盾且无法分辨、疑似错误产品 |

阈值应按字段类型配置；条码身份、图片权利、INCI、capability 和安全规则不应共用同一阈值。

## 3. 自动发布策略

### 可以自动进入 Product Knowledge 的内容

仅限通过 Level 1 gate 的可验证事实：

- Canonical 品牌、产品名称、variant、条码。
- 来源链接、来源类型、获取时间与图片远程引用。
- 明确、无冲突的基础分类/product type。

自动发布必须保留 provenance，并支持后续来源冲突时降级或撤回。它不能暗示成分完整、产品有效或产品安全。

### 只能作为候选的内容

- INCI/成分解析。
- 产品描述与使用方式。
- care role。
- capability。
- 所有安全、禁忌、冲突规则。
- 任意来源不完整、市场/variant 不确定或相互冲突的事实。

## 4. 管理员的例外驱动工作方式

管理员不逐产品审核。队列只接收：

- Identity、variant、barcode 或来源冲突。
- Level 1 未达到自动发布阈值。
- INCI 解析缺失、顺序异常、文本不完整或来源不可靠。
- 所有 Level 3 候选。
- 安全相关结论和影响大范围用户的冲突规则。
- 自动发布后被新来源反证的产品。

队列按影响优先级排序：关联资产数量 × 决策影响等级 × 冲突严重度 × 等待时间。

管理员动作仍为 `approve`、`reject`、`request review`。approve 必须走现有 Review/compile/publication gate；自动化只能准备材料与建议，不可绕过该 gate。

## 5. 与当前架构的映射

- `UserAssetKnowledgeSuggestion` 已可作为 Agent Trigger 的输入。
- `ExternalProductFact` 适合作为 Source Collection 与原始事实容器。
- `KnowledgeCandidate` 已能承载身份、分类与 primary role 的早期候选。
- `ProductKnowledgeReview` 与 compile workflow 是 Level 3 发布闸门。
- Resolver 已正确限制为读取 verified role/capability，并在缺失时使用 product type fallback。

当前 Schema 仍不支持结构化 INCI candidate、capability candidate 或真正的任务队列；本文件定义这些能力的行为合同，不在本阶段新增字段、表或代码。

## 6. 发布不变量

- User Asset 不等于知识生产，也不等于 verified publication。
- AI 不可直接写入 verified care role、capability、安全规则或冲突规则。
- 任何自动发布必须可追溯到来源和字段级证据。
- Rule Engine/Resolver 永远不读取 candidate knowledge。
- 资料不足时保持“未知”，优于生成看似完整的结论。
