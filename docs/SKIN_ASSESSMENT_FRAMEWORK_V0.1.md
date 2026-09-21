# Beauty OS Daily Skin State Assessment Framework v0.1

## 1. Purpose

This document is the authoritative internal standard for interpreting Beauty OS daily skin state.

It supports consumer self-monitoring and longitudinal personal tracking. It is non-diagnostic, is not a universal dermatology severity scale, and does not replace professional medical assessment. A recorded level describes what the user reports or confirms for that day; it does not establish a disease, cause, prognosis, or treatment need.

## 2. Canonical dimensions

Beauty OS has five canonical daily fields:

| Field | Consumer meaning |
| --- | --- |
| `dryness_level` | Today's felt or visible dryness, roughness, tightness, or flaking. |
| `oiliness_level` | Today's felt or visible oil/shine burden. |
| `redness_level` | Today's user-reported or visible facial redness. |
| `sensitivity_level` | Today's subjective stinging, burning, itching, or reactive discomfort. |
| `acne_level` | Today's visible or reported blemish activity, using Beauty OS consumer language only. |

`acne_level` is not medical acne diagnosis, subtype, lesion diagnosis, or disease severity grading.

All fields use `0..4`, but the same number does not carry identical evidence requirements across dimensions. `0` means explicitly absent. A field outside `known_fields` is unknown, which is different from `0`.

## 3. Final 0–4 rubric

### Dryness

| Level | Anchor |
| --- | --- |
| 0 | User explicitly reports no dryness, roughness, or tightness today. |
| 1 | Brief, slight tightness after cleansing or a small mildly rough area; it resolves quickly. |
| 2 | Noticeable dryness or roughness for part of the day, or limited flaking/dry patches. |
| 3 | Clear tightness or roughness much of the day, or obvious dry/flaky patches in one or more areas. |
| 4 | Extensive flaking/peeling or very marked tight, rough discomfort for most of the day. |

### Oiliness

| Level | Anchor |
| --- | --- |
| 0 | User explicitly reports no unusual oiliness or shine today. |
| 1 | Slight shine in a small zone, commonly later in the day. |
| 2 | Noticeable recurring shine in the T-zone, possibly needing one blot. |
| 3 | Obvious or recurrent shine needing repeated blotting, or affecting more than one facial zone. |
| 4 | Very strong, widespread shine repeatedly affecting comfort or appearance. |

### Redness

| Level | Anchor |
| --- | --- |
| 0 | User explicitly reports or confirms no noticeable redness today. |
| 1 | Slight, brief, or localized color change that is barely noticeable. |
| 2 | Noticeable localized redness or recurrent flushing in one area. |
| 3 | Clear, persistent, or broader-area redness noticeable to the user. |
| 4 | Strong, widespread, persistent visible redness. |

### Sensitivity

| Level | Anchor |
| --- | --- |
| 0 | User explicitly reports no stinging, burning, itching, or reactive discomfort today. |
| 1 | Mild, brief stinging or itching after a clear trigger and resolving quickly. |
| 2 | Noticeable recurring discomfort, while usual daily activities and routine remain manageable. |
| 3 | Pronounced or repeated stinging, burning, or itching that makes the user simplify or avoid usual products. |
| 4 | Intense, widespread, or prolonged subjective discomfort. |

### Acne / blemish activity

| Level | Anchor |
| --- | --- |
| 0 | User explicitly reports no new or active blemishes noticed today. |
| 1 | One or two small new blemishes in one area. |
| 2 | Several localized blemishes or repeated small breakouts in one area. |
| 3 | Multiple visible blemishes across more than one area, or a clearly bothersome cluster. |
| 4 | Numerous or widespread blemishes, or notably painful blemishes reported by the user. |

## 4. Evidence hierarchy

Valid evidence sources are conversation/self-report, future image observation, both, and manual correction. A field may also be unknown.

1. Explicit user self-report is the primary source for subjective experience and outranks weak visual inference.
2. Manual correction is an explicit user confirmation and is authoritative for that field.
3. Future image observation may supplement visually observable fields only.
4. When conversation and image agree, retain both provenance values.
5. Image evidence must never silently override explicit self-report.
6. Unknown is not zero. Do not create a level just to complete the five-field record.

## 5. Dimension-specific evidence rules

| Dimension | Valid conversation/self-report | Future image evidence | Invalid image inference |
| --- | --- | --- | --- |
| Dryness | Tightness, dry feeling, roughness, peeling/flaking, persistence and location. | Limited: visible flaking or dry patches after quality gate passes. | Felt tightness, itching, discomfort, or degree without visible evidence. |
| Oiliness | Oily feel, timing, zones, shine, and blotting need. | Obvious shine only; lighting, flash, makeup, and glare are limitations. | Sebum quantity, all-day persistence, or explicit absence. |
| Redness | User-observed redness/flushing, area, duration. | Visible color change, with skin-tone and lighting limitations. | Cause, inflammation, disease, or sensitivity. |
| Sensitivity | Stinging, burning, itch, reactive discomfort, trigger, duration. | None. | Sensitivity from redness, dryness, texture, or any photo feature. |
| Acne/blemishes | New blemish count, area, duration, and pain as reported. | Visible burden and distribution only. | Acne subtype, infection, hormonal cause, cyst/nodule diagnosis. |

## 6. Conversation mapping examples

| User statement | Likely result | Clarification / unknown handling |
| --- | --- | --- |
| “洗完脸有一点紧。” | `dryness_level = 1` if it was brief and only after cleansing. | Ask whether it persisted or flaked before assigning 2+. Other fields remain unknown. |
| “脸颊起皮而且一整天都很干。” | `dryness_level = 3`. | No need to ask about other fields solely to fill them. |
| “鼻子下午明显出油，但脸颊正常。” | `oiliness_level = 2`: clear but T-zone-limited. | Ask about repeated blotting or wider-area shine before assigning 3. Dryness remains unknown unless discussed. |
| “今天脸刺痛但没有明显泛红。” | Sensitivity is known; likely 2 if it was noticeable or recurring. | Redness is `0` only when the user explicitly says no redness; otherwise it remains unknown. |
| “下巴两颗新痘。” | `acne_level = 1`. | Other fields remain unknown. |
| “今天长痘了。” | Blemish activity is mentioned but not safely graded. | Ask count and area before assigning a level. |
| “脸很不舒服。” | No field can be safely assigned. | Ask one focused question about dominant dryness, oiliness, redness, sting/itch, or blemishes. |

## 7. Clarification rules

Ask a clarification only when it materially improves canonical state:

- a named field is too vague to grade safely;
- blemish count or location is needed for a level;
- evidence contains a material contradiction;
- a subjective sensation could map to more than one field;
- distinguishing level 3 from 4 depends on persistence, extent, or strong discomfort.

Do not ask to populate all five fields. A clear one-field state can be ready.

## 8. Readiness rules

`readiness = ready` when at least one canonical field has clear evidence, its level is sufficiently anchored, and no material contradiction remains unresolved.

`readiness = continue` when no canonical field is supported, a statement is too vague to grade, a contradiction requires resolution, or grading would require unsupported inference.

All five fields do not need to be known. When another answer has little value, retain unknown rather than continuing the conversation.

## 9. Future visual observation contract

Future photo analysis should produce intermediate evidence, not final canonical truth:

```ts
type VisualSkinObservation = {
  quality_gate: "pass" | "retake_required";
  visible_redness?: "none" | "slight" | "noticeable" | "marked";
  redness_coverage?: "localized" | "multi_area" | "broad";
  visible_flaking?: "none" | "limited" | "obvious";
  visible_oil_shine?: "none" | "slight" | "noticeable" | "marked";
  visible_blemish_burden?: "none" | "one_to_two" | "several_localized" | "multiple_areas";
  confidence: number;
  limitations: string[];
};
```

Visual AI must not directly output sensitivity, barrier damage, allergy, disease, acne subtype, or a medical diagnosis. Photo observation is evidence for a later merge and user confirmation, not canonical state by itself.

## 10. Safety boundary

If a user reports severe pain, rapidly worsening changes, broken skin, eye involvement, fever, or similarly concerning symptoms, Beauty OS must not diagnose or confidently name a dermatologic condition. It may provide a neutral suggestion to seek professional care. This is not a triage system.

## 11. Long-term use

Only user-confirmed canonical daily states may later contribute to trend evaluation or profile update suggestions. Raw AI proposals and raw photo observations must never directly modify the long-term profile.

## 12. Unsupported inferences

Beauty OS v0.1 must not infer:

- skin barrier damage from a selfie;
- TEWL, skin hydration percentage, sebum percentage, or pH;
- allergies;
- hormonal acne or fungal acne;
- inflammatory disease or any medical diagnosis;
- product suitability;
- Today Routine.

## 13. Current implementation gap

The current V0.1 extractor uses generic lexical mappings:

- “有点/轻微” → 1;
- unqualified mention → 2;
- “很/明显” → 3.

This is not the final assessment logic. It lacks dimension-specific anchors, can map wording too confidently, does not reliably handle count, extent, duration, or distribution, and does not generate level 4 from a proper anchored standard.

The next extraction implementation phase must replace generic lexical mapping with this framework. It must remain stateless, non-diagnostic, confirmation-first, and must preserve unknown fields.
