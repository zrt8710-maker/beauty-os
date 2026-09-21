# Beauty OS Ingredient Knowledge Research Pack v0.1

This document defines the external research contract for the document-backed
V1 source of truth: `docs/ingredient-knowledge/INGREDIENT_KNOWLEDGE_PACK_V1.yaml`.
It supplies narrowly scoped facts about an ingredient's usual cosmetic or
formulation role. It does not contain product claims and it must never state
which skin type, person, or day a product is suited for.

## Resolution contract

Each pack entry uses the same canonical INCI name as the product research
draft's normalized ingredient. Do not create a near-duplicate canonical name
for a translated name, spelling variant, or trade name. `display_name_zh` is
the consumer-readable Chinese name for this Pack.

## Required Pack entry

```json
{
  "canonical_name": "Niacinamide",
  "display_name_zh": "烟酰胺",
  "cosmetic_functions": ["皮脂调理相关"],
  "formulation_roles": ["护肤活性成分"],
  "common_skin_relevance": ["出油状态"],
  "cautions": ["不应仅凭存在该成分就断言产品一定具有某种确定效果"],
  "sources": [{
    "name": "Source title",
    "url": "https://example.com/reference"
  }]
}
```

Each entry must include at least one source. The Pack remains a document; V1
does not write entries to `ingredient_knowledge_facts` or any other database
table.

## Content boundaries

Allowed statements describe general cosmetic context, such as a cleansing
system, humectant-related use, emollient-related feel, or a common formulation
role. They must not claim clinical treatment, guaranteed results, or a
personalised recommendation. Product-level claims, texture, usage, cautions,
and ingredient membership remain in the product research draft.

Today retrieves at most five Pack entries for normalized ingredients already
proven to belong to the candidate product. The Planner decides whether any fact
matters for today's context; hard ingredient safety continues to use its
separate normalized high-confidence path.
