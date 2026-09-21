-- Canonical Catalog images are public product-display metadata. They are
-- deliberately separate from private user-owned upload storage.
alter table public.catalog_products
  add column catalog_image_url text,
  add column catalog_image_source_url text;

alter table public.catalog_products
  add constraint catalog_products_catalog_image_url_https_check
    check (catalog_image_url is null or catalog_image_url ~ '^https://'),
  add constraint catalog_products_catalog_image_source_url_https_check
    check (catalog_image_source_url is null or catalog_image_source_url ~ '^https://');
