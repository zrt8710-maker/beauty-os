# Care Decision Guidance v0.1

## Purpose and authority

This document is advisory knowledge for the Today Care Planner. It helps weigh
effective daily skin state, relevant baseline, weather, and product evidence. It
is not a Rule Engine score table, diagnosis guide, or Product Knowledge write path.

Every item separates: (1) an evidence-backed skincare principle, (2) Beauty OS
decision guidance, and (3) hard system boundaries. The latter remain deterministic:
only eligible owned products; no bypass of avoid-ingredient or high-reaction hard
blocks; no invented product facts, ingredients, capabilities, or diagnoses; and no
use of future weather for today's routine.

## Guidance index

| ID | Situation | Decision direction |
| --- | --- | --- |
| GUIDE-BASELINE-DELTA-01 | Baseline and today's local change differ | Prioritize the relevant daily delta for today's focus. |
| GUIDE-CLEANSE-01 | Cleansing with dry/flaky/reactive context | Keep it gentle; do not intensify for an oily label. |
| GUIDE-MOISTURE-01 | Dryness, tightness, or flaking | Consider hydration, moisturization, and barrier support separately. |
| GUIDE-FLAKE-01 | Dryness, flaking, or roughness | Preserve distinct facts; allow one shared low-irritation direction. |
| GUIDE-OIL-01 | Oiliness | Do not equate oiliness with stronger cleansing or no moisturizer. |
| GUIDE-REACTIVE-01 | Reliable reactive signs | Simplify and reduce nonessential active load. |
| GUIDE-BLEMISH-01 | Blemishes or small bumps | Do not make treatment automatic. |
| GUIDE-TREATMENT-01 | Optional treatment | Maintain, reduce, abstain, or add one only with evidence. |
| GUIDE-WEATHER-01 | Current weather | UV guides AM sun protection; other weather is context only. |
| GUIDE-MIN-SUFFICIENT-01 | Any plan | Add steps only for distinct, evidenced reasons. |
| GUIDE-PRODUCT-FIT-01 | Product selection | Separate product facts from today's fit judgment. |
| GUIDE-UNCERTAINTY-01 | Incomplete information | Make bounded choices; do not hallucinate certainty. |

## Guidance items

### GUIDE-BASELINE-DELTA-01

**Situation:** Long-term oily baseline plus today's localized dryness/flaking.

**Evidence-backed skincare principle:** A skin-type label does not describe every
area on every day; care can be adjusted locally without treating the whole face as
uniformly dry or oily.

**Beauty OS decision guidance:** A confirmed or manual daily change takes priority
for today's local focus. Inherited baseline remains context, never a
today-confirmed fact.

**Planner may:** retain basic cleansing, avoid intensifying oil-control solely for
an oily baseline, and prioritize an evidence-supported moisture-related step.

**Planner must not:** treat inherited oiliness as a new daily observation or infer
that every area needs the same care.

**Rationale:** [AAD moisturizer guidance](https://www.aad.org/public/everyday-care/skin-care-basics/dry/pick-moisturizer?pp=1)
notes that moisturizer choices are not one-size-fits-all.

### GUIDE-CLEANSE-01

**Situation:** Cleansing is considered while dryness, flaking, or reliable
reactive signs are present.

**Evidence-backed skincare principle:** Cleansing is useful, but excessive or
abrasive cleansing can aggravate dryness and irritation; oily/acne-prone skin does
not imply harsher cleansing is better.

**Beauty OS decision guidance:** PM commonly retains a gentle basic cleanse when
an eligible cleanser exists. AM cleansing can be omitted where no distinct reason
exists. Dry/flaky/reactive context favors a simple plan over extra cleansing or
exfoliation.

**Planner may:** simplify, or prefer a source-backed gentle cleanser where
alternatives exist.

**Planner must not:** call a product gentle without evidence or diagnose disease.

**Rationale:** [AAD acne self-care](https://www.aad.org/public/diseases/acne/skin-care/tips)
recommends gentle non-abrasive cleansing; [DermNet](https://dermnetnz.org/cme/dermatitis/emollients)
notes soap/detergents can worsen dry/scaly skin.

### GUIDE-MOISTURE-01

**Situation:** Dryness, tightness, or flaking is confirmed or manually overridden.

**Evidence-backed skincare principle:** Hydration, moisturization/moisture sealing,
and barrier support are related but distinct. Texture is contextual, not determined
by skin type alone.

**Beauty OS decision guidance:** A moisture-related product needs a verified
capability or source-backed product facts supporting its stated purpose. One product
that reliably covers the need can be sufficient.

**Planner may:** prefer a lighter or richer eligible option when evidence and
today's context support that judgment.

**Planner must not:** infer capability from a product name, texture guess, or oily
baseline.

**Rationale:** [DermNet moisturisers](https://dermnetnz.org/topics/emollients-and-moisturisers)
distinguishes humectant and occlusive functions; [AAD dry-skin overview](https://www.aad.org/public/diseases/a-z/dry-skin-overview)
describes why creams/ointments may retain more moisture in very dry contexts.

### GUIDE-FLAKE-01

**Situation:** Dryness, flaking, and/or roughness appears in effective state.

**Evidence-backed skincare principle:** Dryness, visible flaking/scaling, and rough
texture are distinct observable manifestations, though they may jointly support a
low-irritation, moisture-preserving direction.

**Beauty OS decision guidance:** Keep each concern and area in the explanation.
Localized flaking can support less unnecessary irritation and maintained basic
moisturization; an extra hydration step remains contextual.

**Planner may:** explain a shared direction without collapsing `flaking` into
`dryness` or `roughness`.

**Planner must not:** map a grade to a fixed step or expand a local concern to the
whole face.

### GUIDE-OIL-01

**Situation:** Oiliness is inherited or confirmed today.

**Evidence-backed skincare principle:** Oily/acne-prone skin can still be dry or
irritated; repeated washing and drying approaches can worsen irritation.

**Beauty OS decision guidance:** Oiliness is one context signal, not proof that
stronger cleansing is required or moisturizer is unnecessary. Today's localized
dryness/flaking may outrank inherited oiliness for the immediate focus.

**Planner may:** keep a balanced plan when oiliness is stable.

**Planner must not:** use stable baseline oiliness to cancel a supported moisture
step.

**Rationale:** [AAD acne habits](https://www.aad.org/public/diseases/acne/skin-care/habits-stop?pp=1)
notes repeated washing/drying can irritate skin and worsen breakouts.

### GUIDE-REACTIVE-01

**Situation:** Reliable, meaningful redness, stinging, burning, or itching exists.

**Evidence-backed skincare principle:** Irritated skin can warrant avoiding
unnecessary irritating products; this is not a diagnosis.

**Beauty OS decision guidance:** Prefer `simplify` or `barrier_focused` where
eligible products have supporting evidence, and reduce unnecessary active load.

**Planner may:** pause nonessential active steps and state uncertainty.

**Planner must not:** assert product causation without a recorded fact or diagnose
dermatitis, allergy, or disease.

### GUIDE-BLEMISH-01

**Situation:** Blemishes or small bumps are confirmed or inherited.

**Evidence-backed skincare principle:** Breakouts have multiple causes; frequent
changes and irritating routines can be counterproductive.

**Beauty OS decision guidance:** Their presence alone does not establish today's
treatment need. Consider degree, newness, reactivity, product evidence, and whether
one extra step has a distinct purpose.

**Planner may:** abstain from treatment without a supported direction.

**Planner must not:** call small bumps acne or add treatment merely because it is
owned.

**Rationale:** [AAD acne self-care](https://www.aad.org/public/diseases/acne/skin-care/tips)
states that treatment differs between people and irritating routines can worsen the
situation.

### GUIDE-TREATMENT-01

**Situation:** An eligible product could be used as a treatment/active step.

**Evidence-backed skincare principle:** More active products or more frequent
changes do not automatically improve a routine and may add irritation burden.

**Beauty OS decision guidance:** Treatment is optional: maintain, reduce, abstain,
or add one supported step only when product evidence and today's facts establish a
distinct purpose.

**Planner may:** weigh overall layering and irritation context.

**Planner must not:** claim an unverified ingredient conflict or bypass a hard
restriction.

### GUIDE-WEATHER-01

**Situation:** Current temperature, humidity, or UV is available.

**Evidence-backed skincare principle:** UV protection is a clear daytime direction;
temperature and humidity can affect comfort/dryness context but do not replace direct
skin observations.

**Beauty OS decision guidance:** Use UV primarily for AM sun protection. Use other
weather as contextual evidence only; this document creates no fixed thresholds.

**Planner may:** mention weather as one factor in explanation.

**Planner must not:** override confirmed daily facts, use future weather, or invent
a weather-linked product claim.

### GUIDE-MIN-SUFFICIENT-01

**Situation:** Any AM or PM plan.

**Evidence-backed skincare principle:** Available products should not be layered
merely because they exist when the added step is redundant or potentially irritating.

**Beauty OS decision guidance:** Ask what matters today, what selected steps cover,
whether another step fills a distinct need, and whether it adds repetition or
irritation burden. One, two, three, or more steps can be justified within hard
limits.

**Planner may:** choose a smaller or expanded plan with supplied evidence.

**Planner must not:** force a fixed count or add a product solely because it is
opened or low in quantity.

### GUIDE-PRODUCT-FIT-01

**Situation:** Several eligible products could fit today.

**Evidence-backed skincare principle:** Source-backed product facts and a planner's
today-fit judgment are different claims.

**Beauty OS decision guidance:** Fit may consider trusted type, official/source-
backed claims, ingredients, usage, texture, cautions, and verified/draft-derived
capabilities. The resulting judgment must cite its supplied evidence refs.

**Planner may:** say a source-backed moisturizing cream is a better fit for today's
local dryness.

**Planner must not:** write that judgment back as permanent knowledge, use raw
unvalidated agent text, or imply absent ingredient facts.

### GUIDE-UNCERTAINTY-01

**Situation:** Some product or skin fields are unknown.

**Evidence-backed skincare principle:** Incomplete information limits specificity;
it does not itself mean unsafe.

**Beauty OS decision guidance:** Make the smallest useful choice inside known
facts, state material uncertainty, and abstain from unsupported claims. A minimal
follow-up question is allowed if it would materially change the choice.

**Planner may:** choose among several evidence-supported options.

**Planner must not:** invent certainty, ingredients, capabilities, or diagnosis.

## Retrieval contract for a later implementation

Each `GUIDE-*` section is independently retrievable as `guidance_id`, `situation`,
`principle`, `planner_may`, `planner_must_not`, `rationale`, and `authority`
(`evidence_principle`, `beauty_os_guidance`, `hard_boundary`). Retrieve only relevant
sections from effective state, daily delta, period, and weather. This remains
advisory; deterministic validator and persistence contracts retain authority.
