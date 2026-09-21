Beauty OS — Daily Skin v0.9.3 Stabilization Fix

重要：

当前聊天在前几个版本中已经有一版真实浏览器体验明显更好。
最近连续修改后出现回归。

本轮禁止继续重构 conversation orchestration。
禁止新增更多 active/pending/completion/profile priority 机制。
禁止改已经正常工作的 Profile-guided conversation 主流程。

目标只有 3 个：

1. 恢复 today-new concern 的明确提醒 + 一句轻量建议
2. 去掉同一 concern 的重复追问
3. 修复 professional observation provider invalid structured response / 503

==================================================
1. FREEZE CURRENT GOOD CONVERSATION BEHAVIOR
==================================================

以下行为已经基本可接受，不得改坏：

- multi-concern 都能保留
- T-zone oiliness 能使用 Profile baseline 做比较
- known nose-wing dryness 只比较今天变化
- user concerns 处理完后可主动带 ONE 个 Profile topic，例如 blackheads
- 不做 checklist
- 不固定说“我记下了”
- generic completion 不得过早发生

不要重新设计这些逻辑。

==================================================
2. TODAY-NEW CONCERN 必须让用户感知“这是新的”
==================================================

真实场景：

Profile:
- T-zone oiliness baseline exists
- nose-wing dryness baseline exists
- cheek dryness baseline DOES NOT exist

User:
“T区有点油，脸颊和鼻翼有点干”

cheek dryness 必须被视为：

baseline_unknown
+
today_new

当 AI 首次处理 cheek dryness 时，
应该自然让用户知道：

“这是今天新提到的变化 / 长期档案里之前没有特别记录过”

但注意：

Profile missing != absent

禁止说：
“你平时不会脸颊干”
“你以前没有这个问题”

自然语义可以类似：

“脸颊这块是今天新提到的，长期档案里之前没有特别记录过。今天先温和一点，别过度清洁，基础保湿做足就好。现在主要是摸起来粗糙，还是也有紧绷或起皮？”

不要固定照抄文案。

规则：

today_new + baseline_unknown
→ 可选最多一句 lightweight advice
→ 再继续 observable clarification

known baseline concern
→ 不自动给 lightweight advice
→ 只比较今天变化

==================================================
3. CHEEK 与 NOSE-WING 必须分开
==================================================

同轮：

“脸颊和鼻翼有点干”

不能统一处理。

nose_wings:
- known Profile baseline
- compare today vs usual

cheeks:
- no matching baseline
- today-new
- acknowledge newness
- optional one-line advice
- observable clarification

不要再次合并成：

“脸颊和鼻翼干的话先保湿……”

==================================================
4. SAME-CONCERN 不要机械补齐字段
==================================================

当前重复例子：

Assistant:
“是粗糙、紧绷还是起皮？”

User:
“粗糙”

Assistant:
“那有没有紧绷或者起皮？”

用户体验重复。

规则：

如果 concern 已获得足够信息，
不要为了填 schema 继续追问所有剩余维度。

dryness 已确认：
texture = rough

后续只有在 truly useful 时才补 ONE 个新维度。

否则切换到：
- remaining user concern
- baseline comparison
- ONE Profile-guided topic

禁止 paraphrased duplicate question。

==================================================
5. REPORT 503 — 先修 contract，不改报告架构
==================================================

当前真实错误：

SKIN_CONVERSATION_PROVIDER_FAILURE
Skin conversation provider returned an invalid structured response.

请审计：

ProfessionalDailyObservationProvider raw output
→ sanitize / normalize
→ Zod parse
→ service fallback
→ API response

必须找到 exact invalid field / structure。

不要只写“provider failure”。

打印或测试 raw structured payload 的 shape，
确认究竟是哪一个字段导致 strict parse 失败。

==================================================
6. REPORT PROVIDER FAILURE 不得导致用户无报告
==================================================

Professional observation provider 是 optional enhancement。

如果 provider：
- invalid structured output
- timeout
- network error
- non-OK

ProfessionalDailyObservationService 必须：

→ deterministic fallback
→ HTTP 200
→ 仍返回有效 report

不能让整个 report endpoint 503。

provider failure ≠ report failure.

==================================================
7. SAFE NORMALIZATION
==================================================

参考现有 skin conversation provider 的策略：

raw provider output
→ sanitize recoverable optional fields
→ strict canonical parse

不要放松最终 canonical contract。

如果只是：
- extra field
- nullable optional field
- minor formatting issue
- unsupported optional section

可以清理后再 parse。

如果语义本身无效：
→ fallback

==================================================
8. REPORT CONTRACT 保持
==================================================

不要重新设计 Professional Daily Observation schema。

保持现有：

- overall_observation
- baseline_comparison
- key_observations
- continue_observing

或当前真实已冻结 contract。

不要本轮再改字段名 / schema。

==================================================
9. REGRESSION TEST
==================================================

Conversation:

Profile:
- T-zone oily baseline
- nose-wing dry baseline
- no cheek dry baseline
- recurring blackheads

User:
“T区有点油，脸颊和鼻翼有点干”

必须验证：

1. T-zone concern preserved
2. nose-wing known baseline
3. cheek today-new
4. cheek newness is communicated naturally
5. cheek may receive max-one lightweight advice
6. nose-wing does NOT receive same advice
7. confirmed roughness is not re-asked
8. after user concerns, ONE Profile topic may be asked
9. no checklist
10. no early completion

Report:

11. invalid provider structured response does NOT produce 503
12. service falls back to valid professional report
13. strict canonical report contract remains
14. user still receives report when provider fails

==================================================
10. FINAL RESPONSE
==================================================

返回：

A. exact conversation regression cause
B. today-new behavior fix
C. same-concern dedupe fix
D. exact invalid report field / raw shape
E. normalization/fallback fix
F. before/after runtime result
G. tests
H. files changed

最重要：

不要再重构整个聊天。
不要碰已经正常的逻辑。
只修这三个回归点。