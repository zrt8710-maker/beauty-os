create index catalog_products_verified_normalized_identity_idx
on public.catalog_products (
  public.normalize_product_match_text(brand_name),
  public.normalize_product_match_text(product_name)
)
where status = 'verified';

create function public.find_verified_catalog_products_by_identity(
  p_brand_name text,
  p_product_name text
)
returns setof public.catalog_products
language sql
stable
strict
security definer
set search_path = ''
as $$
  select catalog_product.*
  from public.catalog_products as catalog_product
  where catalog_product.status = 'verified'
    and public.normalize_product_match_text(catalog_product.brand_name)
      = public.normalize_product_match_text(p_brand_name)
    and public.normalize_product_match_text(catalog_product.product_name)
      = public.normalize_product_match_text(p_product_name)
  order by catalog_product.id;
$$;

revoke all on function public.find_verified_catalog_products_by_identity(text, text)
from public, anon;
grant execute on function public.find_verified_catalog_products_by_identity(text, text)
to authenticated;
