-- Agent2 discovery creates a Catalog candidate only after a user has confirmed
-- the signed candidate. Candidate identity has no verified knowledge source,
-- category, or product type, so those fields must remain nullable until review.
alter table public.catalog_products
  alter column category drop not null,
  alter column subcategory drop not null,
  alter column product_type drop not null,
  alter column primary_source_id drop not null;

alter table public.catalog_products
  add constraint catalog_products_verified_identity_fields
  check (
    status <> 'verified'
    or (
      category is not null
      and subcategory is not null
      and product_type is not null
      and primary_source_id is not null
    )
  );
