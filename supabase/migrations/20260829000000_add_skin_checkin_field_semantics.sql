alter table public.skin_checkins
  add column known_fields text[],
  add column field_provenance jsonb;

alter table public.skin_checkins
  add constraint skin_checkins_known_fields_array_check
    check (known_fields is null or cardinality(known_fields) <= 5),
  add constraint skin_checkins_field_provenance_object_check
    check (field_provenance is null or jsonb_typeof(field_provenance) = 'object');

comment on column public.skin_checkins.known_fields is
  'Fields explicitly known for this daily record. NULL denotes a pre-v0.1 legacy record; an empty array denotes a new record with no confirmed fields.';
comment on column public.skin_checkins.field_provenance is
  'Per-known-field arrays of manual, conversation, image, or legacy sources. NULL denotes a pre-v0.1 legacy record.';
