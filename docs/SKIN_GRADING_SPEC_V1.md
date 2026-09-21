# Beauty OS — Skin Grading Specification v1

> **Status:** Authoritative product specification  
> **Scope:** Daily Skin Report, Manual Edit, and future longitudinal comparison  
> **Out of scope for v1:** medical diagnosis, triage, treatment selection, conversation prompts, schema/database changes, and UI implementation.

## 1. Purpose and non-negotiable boundary

Beauty OS grades the *observable presentation reported or observed for today*, not a diagnosis, skin type, or a permanent property of the user. It supplies a consistent consumer-facing description for Daily Skin Report and later comparison.

Daily Skin conversation remains natural conversation. It collects natural language and observable facts (for example, “afternoon T-zone shine,” “two small white bumps on the chin,” or “tingles after cleanser”). It **MUST NOT** become a grading questionnaire, ask a user to choose `0–4` or `A/B/C/D`, or expose “severity” as a chat task. Natural clarifying questions are allowed when useful, such as “是一点油光，还是肉眼看起来已经比较明显？” The grade is derived and presented only after finalization, in the report/edit layer. This specification does **not** change any existing conversation prompt.

This is a non-medical daily-care framework. A grade records appearance/experience; it does not identify acne, dermatitis, rosacea, allergy, infection, or any other condition. Escalation/safety behavior belongs to a separate future policy, not to this grading scale.

## 2. Evidence basis and Beauty OS adaptation

### 2.1 Professional source principles

The framework adopts these research-supported design principles:

1. **Anchored ordinal ratings improve consistency.** Skin-quality research has used aspect-specific four- or five-point visual scales, including erythema, pigmentation, pores, roughness, oiliness, and dryness—not one universal visual definition for every feature. The reported rater reliability also varies by feature (for example, pores and roughness are harder to rate consistently), so confidence and `unknown` are necessary. [Skin Quality Assessment Scale](https://pubmed.ncbi.nlm.nih.gov/39382191/); [five-point photonumeric skin-quality scale](https://pubmed.ncbi.nlm.nih.gov/33690945/).
2. **Dryness is multidimensional.** EEMCO guidance evaluates scaling, roughness, redness, and fissures rather than treating “dry” as a single clinical sign. [EEMCO dry-skin guidance](https://pubmed.ncbi.nlm.nih.gov/27328437/).
3. **Acne/comedonal appearance needs type and burden.** Acne studies use both global assessment and lesion counts; work on multidimensional grading explicitly combines primary lesion type/count with secondary change. [Acne global-grading review](https://pubmed.ncbi.nlm.nih.gov/23972509/); [multidimensional acne grading](https://pubmed.ncbi.nlm.nih.gov/31995147/); [photographic lesion-count validation](https://pubmed.ncbi.nlm.nih.gov/36161460/).
4. **Oiliness has visual, tactile, and sensation components.** Consumer self-assessment research separates those domains, and surface-shine imaging correlates with clinical assessment. [Oily Skin Self Assessment Scale](https://pubmed.ncbi.nlm.nih.gov/19508666/); [surface oiliness and shine measurement](https://pubmed.ncbi.nlm.nih.gov/32270323/).
5. **Sensitive-skin discomfort may occur with normal-looking skin.** Stinging, burning, and itch are subjective sensations; erythema can be absent. [IFSI sensitive-skin position paper](https://pubmed.ncbi.nlm.nih.gov/26939643/).

### 2.2 Consumer adaptation

Beauty OS is **not reproducing** clinical IGA, lesion-count thresholds, photonumeric image sets, or diagnostic scales. Its `0–4` is a shared *ordinal language* for presentation only:

| Internal grade | Default Chinese label | Meaning |
|---:|---|---|
| 0 | 无明显表现 | No current observable manifestation in the stated area/context. |
| 1 | 轻微 | Present but limited; usually noticed on close look, touch, or at specific times. |
| 2 | 比较明显 | Clearly noticeable without deliberate searching, but not dominant across the assessed area or day. |
| 3 | 明显 | Readily noticeable and a prominent feature in the assessed area/experience. |
| 4 | 很明显 | Extensive, intense, or strongly prominent in the assessed area/experience. |

The labels are ordinal, not measurements. Grade gaps are not presumed equal, grade `4` does not mean “medical severity,” and a grade should never be inferred merely from a profile, a missing answer, or an absence of mention.

## 3. Common grading contract

### 3.1 Evidence and `unknown`

`grading = unknown` is required when there is not enough current-day evidence to choose an anchor. Examples: the concern is not mentioned; the statement is only historical/baseline; area is unclear when the anchor relies on extent; “不好/不稳定” without an observable description; or the account is internally conflicting and cannot be resolved.

Do **not** assign `0` from silence, missing data, “normal skin,” Profile baseline, prior-day value, or a product routine. Do **not** promote Profile information into today’s grade. Profile may help phrase a natural follow-up or provide baseline context only.

### 3.2 Area, timing, and evidence quality

Record area when supplied (for example, T-zone, nose, cheeks, chin, jawline, whole face) and relevant timing/trigger (for example, afternoon, after cleansing, after product) as context. A reported *change* without a current presentation is insufficient for a grade.

“Reliable grade” for future comparison means: current-day evidence supports a concern-specific anchor; the area is same or compatible; no unresolved ambiguity; and it has not been superseded by an incompatible manual edit. This is a product reliability flag, not a claim of clinical validity.

### 3.3 Automatic-mapping restraint

Automatic mapping selects the **lowest grade fully supported by current evidence**. It may not upgrade merely because of alarming wording (“爆痘”, “很糟”), a diagnosis label, product use, one isolated mention, baseline skin type, or a past grade. It may not convert uncertainty into a higher grade. When evidence supports more than one possible grade, choose `unknown` unless a conservative lower anchor is fully established.

## 4. Concern specifications

### 4.1 Direct 0–4 presentation concerns

Each row gives: **A** display name; **B** suitability; **C** judgment dimensions; **D** observable anchors; **E** required `unknown` cases; **F** automatic-upgrade prohibition; **G** Manual Edit choices. “Area” means the area the user described, not automatically the whole face.

#### Oiliness (`oiliness`)

- **A–C:** 出油; **yes**, direct `0–4`; visible shine/oily film, touch, blotting need, and area/time.
- **D:** `0` no noticeable shine/oily feel; `1` slight shine or slightly oily touch in a small area/late in day; `2` obvious shine/oily feel in a named zone or repeated need to blot; `3` pronounced shine/oily film across a zone or multiple zones, difficult to ignore; `4` very strong, widespread shine/oily film or repeatedly disruptive through the day.
- **E:** `unknown` if “油皮” is only a baseline, the day/time or visible/tactile current evidence is absent, or shine could only be makeup/sunscreen without clarification.
- **F:** Do not upgrade from “oil-prone,” one product’s finish, heat/humidity alone, or an unquantified “a bit greasy.”
- **G:** 无明显表现 / 轻微 / 比较明显 / 明显 / 很明显; optional attributes: area, timing, visible shine vs oily feel, blotting needed.

#### Dryness (`dryness`)

- **A–C:** 干燥; **yes**, direct `0–4`; tight/dry feel, reduced suppleness, and persistence/area. Flaking and roughness remain separate concerns.
- **D:** `0` no dry/tight feeling or visible dry look; `1` slight tightness/dry feel, usually after cleansing or in a small area; `2` clear dryness/tightness or less supple look in a zone; `3` persistent, obvious dryness/tightness across a zone/multiple areas; `4` very pronounced, widespread dryness/tightness that is strongly noticeable through the day.
- **E:** `unknown` if only “dry skin” profile is known, or current feeling/appearance and area are absent.
- **F:** Do not upgrade from low humidity, use of actives, a past dry episode, or flaking alone.
- **G:** five text grades; optional: area, timing/trigger, tightness vs dry look.

#### Flaking (`flaking`)

- **A–C:** 起皮 / 脱屑; **yes**, direct `0–4`; visible loose scale, amount, and extent.
- **D:** `0` no visible flakes; `1` a few fine flakes, usually only close up; `2` clearly visible flakes in one localized area; `3` conspicuous flakes across a zone or several areas; `4` extensive/thick or repeatedly shedding flakes across much of the described area.
- **E:** `unknown` if “dry” is reported without actual flakes, or residue/product pilling cannot be distinguished from flakes.
- **F:** Do not upgrade from dryness, rough touch, makeup texture, or a prior episode alone.
- **G:** five text grades; optional: area, fine vs larger flakes, visible vs only felt.

#### Roughness (`roughness`)

- **A–C:** 粗糙感; **yes**, direct `0–4`; uneven texture felt by touch and/or visibly uneven surface, separate from discrete bumps.
- **D:** `0` surface feels and appears generally smooth; `1` slight uneven/less smooth feel in a small area; `2` clearly rough/uneven feel or look in one zone; `3` obvious rough texture across a zone/multiple areas; `4` strongly coarse/uneven texture broadly prominent in the stated area.
- **E:** `unknown` if “texture不好” has no observation, or it is unclear whether the issue is flaking, pores, or bumps.
- **F:** Do not upgrade from enlarged pores, one transient pimple, makeup settling, or generic “肤质差.”
- **G:** five text grades; optional: area, touch / visual / both.

#### Redness (`redness`)

- **A–C:** 泛红; **yes**, direct `0–4`; color contrast from surrounding skin, intensity, extent, and persistence. It is not a diagnosis.
- **D:** `0` no noticeable redder area; `1` faint, localized, or brief redness; `2` clearly visible redness in one area or repeatedly after a trigger; `3` prominent redness across a zone/multiple areas or persisting for much of the day; `4` intense or widespread redness strongly dominating the described area.
- **E:** `unknown` if lighting, makeup, exercise/heat timing, or baseline complexion makes a current visual observation indeterminate; redness cannot be assumed from discomfort.
- **F:** Do not upgrade from sensitive-skin profile, warmth alone, stinging alone, or a named condition.
- **G:** five text grades; optional: area, persistent vs triggered, visible color vs warmth (warmth alone does not set redness).

#### Stinging (`stinging`), itching (`itching`), burning (`burning`)

- **A–C:** 刺痛 / 发痒 / 灼热感; **yes**, direct `0–4`; user-reported sensation intensity, area, duration, and recurrence. These are three distinct concerns and are never inferred from each other or from redness.
- **D:** `0` no sensation today; `1` slight and brief, localized sensation; `2` clearly noticeable sensation that recurs or lasts beyond a moment in one area; `3` strong or persistent sensation, or affecting multiple areas; `4` very intense, prolonged, or broadly prominent sensation that substantially dominates the user’s experience today.
- **E:** `unknown` if the sensation is only anticipated/historical, body location is unclear, or “敏感” is reported without a current sensation.
- **F:** Do not upgrade from an ingredient, a sensitive-skin profile, visible redness, or another discomfort type; do not turn “tingling” into stinging without user wording/confirmation.
- **G:** five text grades for each concern; optional: area, trigger, duration, one-time vs recurring. Manual Edit may set each independently.

#### Dullness (`dullness`)

- **A–C:** 暗沉 / 缺乏光泽; **yes**, direct `0–4`; overall lack of brightness/radiance relative to nearby facial skin or the user’s usual current appearance, plus extent. It is not a pigment diagnosis.
- **D:** `0` no noticeable dull appearance; `1` slight loss of radiance, usually close-up or in limited lighting; `2` clearly less bright/radiant across a named area; `3` obvious dull cast across most of the described face/area; `4` very pronounced, broadly dominant lack of radiance.
- **E:** `unknown` if only fatigue, a baseline complexion label, lighting, or makeup is mentioned without current visual observation.
- **F:** Do not upgrade from sleep loss, “yellowish” alone, tanning, or a historical comparison with no present observation.
- **G:** five text grades; optional: area, overall vs localized, bare-skin observation / makeup context.

#### Uneven tone (`uneven_tone`)

- **A–C:** 肤色不均; **yes**, direct `0–4`; visible patchiness/variation in tone, contrast, and extent, excluding a named post-blemish mark where possible.
- **D:** `0` no noticeable tonal patchiness; `1` faint, localized variation; `2` clear unevenness in one zone or several small areas; `3` obvious contrast/patchiness across multiple areas; `4` marked, widespread uneven tone dominating the described facial appearance.
- **E:** `unknown` if based solely on one mark, lighting/camera color cast, makeup, tanning history, or “肤色暗” with no variation description.
- **F:** Do not upgrade from redness, dullness, ethnicity/skin tone, or profile baseline.
- **G:** five text grades; optional: area, color variation type (red/brown/other/unsure), localized vs widespread.

#### Post-blemish marks (`post_blemish_marks`)

- **A–C:** 痘后印 / 痘印; **yes**, direct `0–4` for presentation **when individual marks are distinguishable**; visibility/contrast, amount, and extent. It describes residual color marks after blemishes, not scars, and is not restricted to one pigment color. Visual assessment is central in professional PIH work, but Beauty OS does not diagnose PIH. [Acne-induced PIH grading review](https://pubmed.ncbi.nlm.nih.gov/40263971/).
- **D:** `0` no noticeable post-blemish marks; `1` one/few faint, localized marks; `2` several clearly visible marks in one zone or a few areas; `3` numerous or high-contrast marks across multiple areas; `4` extensive and strongly prominent marks across much of the described area.
- **E:** `unknown` if a mark cannot be linked to a prior blemish, whether it is active inflammation vs residual mark is unclear, or color/lighting prevents recognition.
- **F:** Do not upgrade from active blemishes, general uneven tone, old scars, or a history of acne alone.
- **G:** five text grades; optional: amount (one/few/several/many), extent, red/brown/darker-than-surrounding/unsure, localized vs multiple areas.

### 4.2 Structured concerns: amount + extent + type, then presentation grade

`blackheads`, `small_bumps`, `blemishes`, and `visible_pores` are **not well represented by one raw severity variable**. Their visible presentation depends on more than intensity: amount, extent, and morphological type/appearance matter. This follows the professional distinction between lesion types/counts and global presentation, and recognizes that pores have lower visual-rating reliability than some other features. [Multidimensional acne grading](https://pubmed.ncbi.nlm.nih.gov/31995147/); [facial-pore photographic scale](https://pubmed.ncbi.nlm.nih.gov/21302460/); [skin-quality reliability study](https://pubmed.ncbi.nlm.nih.gov/33690945/).

For these concerns, collect **attributes first**, calculate an internal `presentation_grade` only when the mapping is supported, and display the text grade. The grade is a summary—not a replacement for attributes. A manual confirmation/adjustment of the presentation label has higher priority than automatic mapping, while retaining attributes for context.

Common attributes:

| Attribute | Allowed consumer values |
|---|---|
| `amount` | none / one-or-few / several / many / unknown |
| `extent` | localized / one-zone / multiple-areas / widespread / unknown |
| `type` | concern-specific values below, or unknown |

Mapping rule: `0` only requires explicit current absence. For `1–4`, map the observable burden conservatively: isolated/few and localized → `1`; clearly noticeable but limited to one zone or several localized findings → `2`; many findings or multiple areas → `3`; many findings plus widespread extent, or a highly prominent pattern → `4`. If amount or extent is unknown and no direct anchored description resolves it, use `unknown`. Type modifies the visible description and may require `unknown`; it must not inflate the grade by itself.

#### Blackheads (`blackheads`)

- **A–C:** 黑头; **no** to a single raw severity. Use `amount + extent + type`, where type is `blackheads/black dots`, `sebaceous filaments-like`, `unsure`. Only user-observable blackheads should be recorded; do not diagnose from pore appearance.
- **D:** `0` explicitly none; `1` one/few dark plugs/dots, localized; `2` several clearly visible blackheads in one zone (commonly nose/chin); `3` many in one zone or clearly visible across multiple areas; `4` very many and widespread/highly prominent across the described areas.
- **E:** `unknown` when black dots vs normal sebaceous filaments/pores cannot be distinguished, or amount/extent is absent.
- **F:** Do not upgrade from oiliness, visible pores, an acne-prone profile, or “毛孔脏”; do not classify any dark pore as a blackhead.
- **G:** text grade plus amount, extent/area, and type/“不确定”; a manual text-grade choice overrides mapper output.

#### Small bumps (`small_bumps`)

- **A–C:** 小颗粒 / 小凸起; **no** to a single raw severity. Use `amount + extent + type`, where type is `skin-colored`, `white-topped`, `rough tiny bumps`, `red/inflamed`, `unsure`. This is a surface description, not a diagnosis or acne subtype.
- **D:** `0` explicitly no small bumps; `1` one/few tiny bumps, localized; `2` several noticeable bumps in one zone; `3` many bumps in a zone or present in multiple areas; `4` very many/widespread bumps strongly changing the visible surface.
- **E:** `unknown` if it could be roughness/flaking/follicular texture rather than discrete bumps, type cannot be described, or burden/area is absent.
- **F:** Do not upgrade from roughness, one active blemish, product use, or an acne label; red/inflamed type does not automatically mean grade `3`/`4`.
- **G:** text grade plus amount, extent/area, and type; manual text grade overrides mapping.

#### Blemishes (`blemishes`)

- **A–C:** 痘痘 / 痘点; **no** to a single raw severity. Use `amount + extent + type`, where type is `red bump`, `white/yellow-topped`, `deeper/tender`, `non-inflamed-looking`, `unsure`. It is an everyday visual term, not a medical acne grade.
- **D:** `0` explicitly no active blemishes; `1` one/few localized blemishes; `2` several clearly visible in one zone or a few separate areas; `3` many in one zone or active blemishes across multiple areas; `4` very many/widespread and strongly prominent active blemishes in the described areas.
- **E:** `unknown` if an active blemish cannot be distinguished from a residual mark, small bump, or other spot, or amount/extent is not known.
- **F:** Do not upgrade from “爆痘” without current observable burden, a single painful/deep mention, post-blemish marks, or profile acne history. Type must be retained, not collapsed into a diagnostic judgement.
- **G:** text grade plus amount, extent/area, type, optional tenderness (yes/no/unknown). Manual text grade overrides mapping.

#### Visible pores (`visible_pores`)

- **A–C:** 毛孔可见 / 毛孔明显; **no** to a single raw severity. Use `amount + extent + type`, where type is `individual/enlarged-looking openings`, `dense visible texture`, `with dark contents`, `unsure`. “With dark contents” should cross-reference blackheads rather than force a blackhead grade.
- **D:** `0` no noticeably visible pores; `1` a few/slightly visible pores on close look in a localized area; `2` clearly visible pores in one zone; `3` conspicuous pores/dense pore texture across multiple areas; `4` very prominent and widespread pore appearance dominating texture in the described areas.
- **E:** `unknown` if the observation is actually blackheads, makeup texture, lighting/camera artefact, or an undefined “毛孔大”; area/visibility must be known.
- **F:** Do not upgrade from oiliness, age, skin type, or blackheads alone; do not imply pores are “open/closed” or medically abnormal.
- **G:** text grade plus amount/visibility, extent/area, and type; manual text grade overrides mapping.

## 5. Report-layer presentation

The report may show only the user-facing concern, area/context, and text grade by default—for example:

> **T 区 · 出油**  
> 轻微  
> [查看程度说明]

Internal numerals are not required in the default report. “查看程度说明” expands the full concern-specific anchors, headed for example **“出油程度怎么判断？”**, with the five labels and the exact observable language in section 4. It must show `当前信息不足，暂不评级` for `unknown`, rather than silently displaying `无明显表现`.

For structured concerns, the report may additionally show concise factual attributes (for example, “鼻翼/鼻头 · 几处黑色小点”) when supported. It must not invent attributes, show an automated grade as a diagnosis, or hide a manual override.

## 6. Manual Edit rules

“调整今日状态” operates in user language:

- Direct concerns: choose one of **无明显表现 / 轻微 / 比较明显 / 明显 / 很明显**, or mark **暂不确定**; optionally refine the concern-specific attributes listed above.
- Structured concerns: choose the same presentation label **and** edit `amount`, `extent/area`, and `type` with consumer terms. Attributes are informative; the user does not need to understand internal integers or mapper logic.
- Once the user manually confirms or changes a presentation label for a concern/day, that manual label takes precedence over automatic `presentation_grade`. Keep provenance (`manual` versus `automatic`) and supplied attributes. A later deliberate manual change replaces the earlier manual label.
- Manual `暂不确定` is authoritative: do not regenerate a grade from Profile, prior days, or incomplete attributes in the same report.

## 7. Future Weekly/Monthly comparison principles

Comparison is allowed only when all conditions hold: (1) same concern; (2) same or compatible area/context; (3) both days have reliable grades; (4) concern definition and mapper version are compatible; (5) any manual override is honored. `unknown` never participates in numeric comparison.

At the evidence level only:

| Earlier → later | Permitted wording |
|---|---|
| 1 → 2 (or higher) | evidence that the presentation was more noticeable on the later day |
| 2 → 1 (or lower) | evidence that the presentation was less noticeable on the later day |
| 1 → 1 | stable evidence for those two observations |

One grade change is **not** enough for a Weekly/Monthly summary to formally say “加重” or “改善.” Such conclusions require multiple reliable observations, sensible time windows, compatible areas, and a future aggregation policy that handles normal daily variation. Structured concerns should compare compatible attributes as well as presentation grade; a changed type or non-compatible area should suppress the directional conclusion.

## 8. Governance and implementation path

This document is the authoritative source. Concern-specific anchors **MUST NOT** be copied into conversation prompts or scattered across components.

Future implementation sequence:

```text
docs/SKIN_GRADING_SPEC_V1.md
  → one centralized, versioned grading config / mapper
  → shared report renderer + Manual Edit controls
  → shared Weekly / Monthly comparison consumer
```

The future machine-readable config should centralize: concern id, labels, anchor copy, required evidence, allowed attributes/options, structured mapping rules, compatibility rules, provenance, and spec version. It must return `unknown` explicitly and retain evidence/area/context. Any change to anchors or mappings requires a new spec/config version and migration policy before comparisons cross versions.

## 9. Acceptance checklist for future implementation

- No conversation, conversation prompt, finalize behavior, save behavior, `daily_state` schema, Profile schema, weekly/monthly code, `/check-in` UI, DB, or migration is changed by this specification document.
- Chat collects natural descriptions only; it never requests a numeric or letter grade.
- Report defaults to text grade and provides concern-specific explanation on demand.
- Silence and Profile baseline yield `unknown`, never an assumed `0` or higher grade.
- Blackheads, small bumps, blemishes, and visible pores preserve amount + extent + type and map conservatively to a presentation grade.
- Manual confirmation supersedes automatic presentation mapping.
- Future longitudinal language is evidence-aware and does not infer improvement/worsening from one day.

## 10. Observation-method addendum (v1.1)

### 10.1 Purpose and structure

An `observation_method` teaches a person how to make a useful everyday observation before they consult the grade anchors. It is an aid for Report, Profile, and Manual Edit help—not a diagnostic procedure, score questionnaire, or conversation script. It must be stored with the concern definition in future centralized configuration, alongside (not inside) its ordinal anchors.

Every concern's `observation_method` contains these consumer-facing fields:

| Field | Required content |
|---|---|
| `look_at` | Areas or circumstances to observe. |
| `how_to_observe` | Everyday viewing distance, angle, timing, and comparison method. |
| `focus_on` | The visible or felt feature that differentiates the concern. |
| `touch_ok` | Whether clean, gentle touch can assist; never squeeze, scrape, or rub repeatedly. |
| `best_conditions` | Lighting/skin state that makes the observation more trustworthy. |
| `avoid_when` | Conditions that can distort the observation and should lead to waiting or `unknown`. |
| `plain_language_note` | A reminder to describe what is seen/felt rather than use medical labels. |

Future help UI order is fixed: **A. 怎么看** (the method) → **B. 程度参考** (the concern's existing observable anchors). It must show text labels, not `0–4`, anchor ids, confidence, evidence, or mapper rationale. The help is informational only; it must never be inserted into Daily Skin conversation or used to request a numeric answer.

### 10.2 Concern-specific `observation_method`

#### Oiliness (`oiliness`) — 出油

- **看哪里 / 怎么看：** 在洗脸后、未刻意补妆的正常一天里，按平时照镜子的距离看 T 区、鼻子、额头和容易出油的脸颊；可在中午或下午与刚清洁后比较。
- **重点观察：** 是一点反光、看得见的油光/油膜，还是摸起来油；留意是否需要反复吸油。
- **可否触摸：** 可以用干净指腹轻触一次辅助判断油感，不要反复摩擦。
- **适合 / 不适合判断：** 自然光或均匀室内光、无滤镜、薄涂或未涂厚重产品时更合适；刚涂高光、厚防晒、厚面霜、刚运动出汗或强闪光灯下不适合单独判断。
- **不用术语：** 说“鼻子下午有油光”或“脸颊摸着油”，不要用“皮脂异常”等词。

#### Dryness (`dryness`) — 干燥

- **看哪里 / 怎么看：** 看鼻翼、脸颊、口周等常有紧绷感的区域；洗脸后、上妆前或一天中觉得不舒服时，用正常距离观察并回想是否持续。
- **重点观察：** 紧、干、欠柔润或看起来不够平整；起皮与粗糙要分别记录。
- **可否触摸：** 可以用干净指腹轻轻按/滑过一次，感受是否干涩或不够柔滑。
- **适合 / 不适合判断：** 清洁后已自然干燥、自然/均匀光线下较合适；刚涂保湿霜、厚底妆、刚用热水洗脸或只是环境一时很干时，不要据此直接定级。
- **不用术语：** 说“洗完脸两颊发紧”或“鼻翼看着干”，不要把它直接称为屏障受损。

#### Flaking (`flaking`) — 起皮 / 脱屑

- **看哪里 / 怎么看：** 观察鼻翼、口周、眉间、脸颊和上妆容易卡粉的位置；在自然光或侧光下近看一次，再退回正常距离确认是否仍可见。
- **重点观察：** 是否真有松散小皮屑、细屑或反复脱落，而不是单纯干感。
- **可否触摸：** 可轻触确认表面是否有细屑；不要搓、抠或撕。
- **适合 / 不适合判断：** 洁面后自然干燥、未叠厚重产品时较可靠；产品搓泥、粉底卡纹、面膜残留或滤镜下不适合判断为起皮。
- **不用术语：** 说“鼻翼有细小皮屑”，不要把残留物或搓泥当作脱屑。

#### Roughness (`roughness`) — 粗糙感

- **看哪里 / 怎么看：** 看并轻触脸颊、下巴、额头等觉得不平滑的位置；以一个干净、未被厚重产品覆盖的区域作为对照。
- **重点观察：** 是连续不平整/不够柔滑的表面，还是可分辨的单个小凸起、毛孔或皮屑。
- **可否触摸：** 可以，干净指腹轻轻单向滑过一次即可。
- **适合 / 不适合判断：** 自然光、清洁且未上厚妆时较合适；刚去角质、反复摸脸、产品膜感、明显起皮或单颗痘痘存在时，不要混作粗糙。
- **不用术语：** 说“摸起来不够平滑”，不要用“角质堆积”作未经确认的解释。

#### Redness (`redness`) — 泛红

- **看哪里 / 怎么看：** 看脸颊、鼻翼、鼻周、下巴等相邻肤色可比较的位置；在同一面镜子、自然光或均匀白光下看颜色与周围皮肤的差异。
- **重点观察：** 颜色是否更红、范围多大、是否在刺激后反复或持续；发热感本身不等于泛红。
- **可否触摸：** 不需要；触摸或揉搓会本身制造红色。
- **适合 / 不适合判断：** 静坐、未运动、未洗热水澡一段时间后更合适；刚运动、喝酒、热水、强冷风、卸妆摩擦、彩妆遮盖或彩色光线下不适合判断。
- **不用术语：** 说“脸颊比周围红一片”，不要自行判定为某种皮肤病。

#### Stinging (`stinging`) — 刺痛

- **看哪里 / 怎么看：** 留意使用产品、清洁、出汗或环境变化后哪个区域有针刺/刺刺的感觉，并记住是一下就过还是反复出现。
- **重点观察：** 感觉的强弱、持续时间、范围和是否再次出现；不要由红色替代对感觉的描述。
- **可否触摸：** 不建议为了确认而触碰或重复涂抹可能刺激的产品。
- **适合 / 不适合判断：** 发生当下或刚发生后按实际感受记录最可靠；只回想很久以前、预期会刺或只看到泛红时不适合分级。
- **不用术语：** 说“涂完鼻翼有短暂刺刺感”，不要用诊断名称。

#### Itching (`itching`) — 发痒

- **看哪里 / 怎么看：** 留意哪个区域想抓、痒感何时出现、是否反复以及是否影响注意力。
- **重点观察：** 轻微想挠、清楚发痒、持续/多区域发痒之间的差别；红色不是痒感的替代证据。
- **可否触摸：** 不建议抓挠来确认；可只用清洁指腹轻碰定位。
- **适合 / 不适合判断：** 在感受发生时按持续和范围描述；睡前模糊回忆、被衣物/头发短暂擦到或已抓挠后的痕迹不适合单独定级。
- **不用术语：** 说“下巴偶尔发痒”，不要把它直接叫作过敏。

#### Burning (`burning`) — 灼热感

- **看哪里 / 怎么看：** 留意清洁、产品或环境后哪个区域有发烫、灼热或像热辣的感觉，并观察多久消退。
- **重点观察：** 感觉是否局部、持续、反复或影响继续使用产品；视觉泛红可另记，不能代替灼热感。
- **可否触摸：** 不建议用摩擦或继续使用同一刺激源测试。
- **适合 / 不适合判断：** 发生时或短时间后记录；仅凭“皮肤偏敏感”、天气热或他人观察到发红时不适合判断。
- **不用术语：** 说“洗完脸两颊有灼热感”，不要自行判断病因。

#### Blemishes (`blemishes`) — 痘痘 / 痘点

- **看哪里 / 怎么看：** 在自然光下看额头、脸颊、下巴、下颌等当天新出现或活跃的位置，先看整体再看局部。
- **重点观察：** 是一两颗还是多颗、集中一处还是多个区域；区分仍在活动的凸起/痘点与留下的平色印记。
- **可否触摸：** 不要挤压；如需要，可非常轻地触碰一次确认是否是凸起或有触痛。
- **适合 / 不适合判断：** 洁净皮肤、未被遮瑕完全覆盖时较合适；滤镜、近距离放大、挤压后、刚卸妆的暂时泛红或只凭“爆痘”说法不适合定级。
- **不用术语：** 说“下巴有几颗红色凸起”，不要自行区分医学痤疮亚型。

#### Small bumps (`small_bumps`) — 小颗粒 / 小凸起

- **看哪里 / 怎么看：** 在自然光或柔和侧光下看额头、下巴、脸颊等常见区域；先用正常距离看，再用干净手指轻触。
- **重点观察：** 表面是否有连续细小凸起，是零散几颗、局部一片还是多个区域；注意是否能与粗糙、起皮区分。
- **可否触摸：** 可以轻摸感受颗粒感；不要挤、抠或来回摩擦。
- **适合 / 不适合判断：** 皮肤干净、未使用强滤镜、磨皮相机或厚重产品后较合适；刚涂厚霜、妆感纹理、明显起皮或光线过暗时不适合判断。
- **不用术语：** 说“小小的凸起/颗粒感”，不要强行称为闭口或其他医学名词。

#### Blackheads (`blackheads`) — 黑头

- **看哪里 / 怎么看：** 看鼻头、鼻翼、下巴等容易有深色小点的位置；先按正常照镜子距离看，再近一点确认数量和范围。
- **重点观察：** 是否是可见的深色栓/小点、是少数还是密集、局限还是多个区域；与均匀的毛孔纹理或皮脂丝样外观区分。
- **可否触摸：** 可以轻触看表面，不要挤压或用工具清理来“证明”它是黑头。
- **适合 / 不适合判断：** 自然或均匀室内光、无重滤镜和厚粉底时较合适；强放大镜、阴影、鼻部彩妆残留、刚清洁后泛红时不适合判断。
- **不用术语：** 说“鼻子有几处深色小点”；分不清时应选不确定，而不是把所有毛孔都叫黑头。

#### Visible pores (`visible_pores`) — 毛孔可见 / 毛孔明显

- **看哪里 / 怎么看：** 看鼻子、鼻翼、两颊靠近鼻侧等区域；以平时洗漱照镜子的距离观察，再确认是否只有近看才可见。
- **重点观察：** 单个开口是否明显、是否形成密集纹理、涉及一个区域还是多个区域；深色内容应另参考黑头。
- **可否触摸：** 不需要；触摸不能可靠判断“毛孔大小”。
- **适合 / 不适合判断：** 自然/均匀光、裸脸或轻薄底妆时较合适；手机放大、强侧光制造阴影、厚粉底卡纹、滤镜或刚挤压后不适合判断。
- **不用术语：** 说“鼻翼近看毛孔清楚”，不要说毛孔“开/关”或医学异常。

#### Dullness (`dullness`) — 暗沉 / 缺乏光泽

- **看哪里 / 怎么看：** 看整体面部以及常觉得不透亮的区域，在自然光或均匀室内白光下用平时距离观察。
- **重点观察：** 是否整体少了光泽、看起来不够明亮，而非仅一个色斑、一次阴影或单纯疲劳感。
- **可否触摸：** 不需要；暗沉主要是视觉观察。
- **适合 / 不适合判断：** 裸脸或妆感很轻、光线稳定时较合适；黄光、背光、滤镜、厚底妆、刚晒后肤色变化或只根据睡眠不足推断时不适合判断。
- **不用术语：** 说“整体看起来没那么透亮”，不要把它等同于色素问题。

#### Uneven tone (`uneven_tone`) — 肤色不均

- **看哪里 / 怎么看：** 在自然/均匀白光下，看脸颊、额头、下巴等相邻区域的色调是否有可见差异。
- **重点观察：** 是局部轻微色差、数个小区域，还是多区域斑驳；可把明确痘后印单独记录。
- **可否触摸：** 不需要。
- **适合 / 不适合判断：** 裸脸或底妆很轻、同一光线和角度下较合适；彩色光、相机白平衡、阴影、腮红/遮瑕、刚晒后或只看一颗痘印时不适合判断。
- **不用术语：** 说“脸颊和额头颜色不太均匀”，不要推断色素诊断。

#### Post-blemish marks (`post_blemish_marks`) — 痘后印 / 痘印

- **看哪里 / 怎么看：** 看曾长痘的位置，尤其脸颊、下巴、额头；在均匀光线下先看整体，再确认是否为痘后留下的平色印记。
- **重点观察：** 印记数量、颜色与周围的对比、局限/多区域；要与仍在活动的红肿痘点及凹凸不平的旧疤区分。
- **可否触摸：** 通常不需要；如轻触发现明显凸起或凹陷，应不要把它仅作为“印记”分级。
- **适合 / 不适合判断：** 裸脸、光线均匀、未用遮瑕时较合适；滤镜、强闪光、刚挤压后的暂时红色、无法确认与旧痘关联时不适合判断。
- **不用术语：** 说“下巴有几处痘后留下的颜色印记”，不必自行判断色沉类型。

### 10.3 Implementation rule for future help UI

`observation_method` is a help resource, not a grading input. A future UI can render it as a concise checklist before the anchor list, but it must not turn unchecked items into `unknown` automatically or derive a grade from the reading path. A person may still choose `暂不确定` after reading it. Any machine-readable implementation must be centralized with `SKIN_GRADING_CONFIG`; components and prompts must not duplicate it.

## 11. Long-term oiliness/dryness baseline design audit (v1.1)

### 11.1 Current contract

`usual_oily_areas` and `usual_dry_areas` are area-only long-term baselines. They say **where** the user is usually prone to oiliness or dryness; they do not say how often it happens, how strong it usually is, or what today's grade should be. This is intentional and is distinct from `recurring_tendencies[].frequency + usual_intensity`.

### 11.2 Recommendation

Do **not** add `usual_oiliness_intensity` or `usual_dryness_intensity` now. Area-only baseline already supports the most valuable Daily-vs-Profile comparison: whether today's area is familiar versus newly observed. Adding a single intensity for a multi-area list would be ambiguous (for example, nose versus cheeks), duplicate Daily grading semantics, and add schema/UI complexity without reliable evidence.

The existing structure is sufficient until a concrete user problem requires long-term usual intensity for oiliness/dryness. If that need is later validated, the minimum safe design is **not** a scalar beside an area array. Use area-scoped records, for example conceptually:

```text
usual_oiliness_baselines: [{ area, usual_intensity: slight|noticeable|marked|very_marked|unknown }]
usual_dryness_baselines: [{ area, usual_intensity: slight|noticeable|marked|very_marked|unknown }]
```

This would require a deliberate Profile schema/data migration and a user-confirmed editor flow. It must not be inferred from daily grades or from the mere presence of an area. It is explicitly future design, not a v1.1 change.

### 11.3 Daily/Profile boundary reaffirmed

- **Daily grade:** how noticeable this concern is on this one day.
- **Profile usual intensity:** how noticeable a recurring tendency usually is when it appears.
- Neither value may automatically overwrite, backfill, or generate the other.
- Future repeated Daily/Weekly/Monthly evidence may create a **Profile update suggestion only**; the user must confirm before the long-term baseline changes.
- Observation methods belong only to Report/Profile/Edit help. They must not be turned into a conversation questionnaire or added to conversation prompts.

### 11.4 Future minimum implementation order

1. Add `observation_method` to the centralized machine-readable grading configuration, derived from this specification.
2. Render **怎么看 → 程度参考** in Report, Profile, and Manual Edit help using that single configuration.
3. Add tests that ensure help excludes internal grades/debug fields and never changes mapper output.
4. Collect product evidence before considering area-scoped long-term oiliness/dryness intensity; only then design schema/UI migration separately.
