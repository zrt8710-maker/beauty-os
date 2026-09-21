# IDENTITY BOUNDARY HARDENING V0.1

## Implemented

- External candidates now carry a server-signed, 15-minute confirmation token and confirmation ID.
- External asset creation requires that token; it is bound to user, identity fields, and the same idempotency key.
- Asset creation uses a new idempotent RPC. The first successful request creates the asset; a matching retry returns it. Reusing a key with different identity fields is rejected.
- The original asset-created enrichment call was removed. Creation now emits only an asynchronous `verified_knowledge_linked` or `enrichment_suggested` signal; it does not write facts, candidates, verified knowledge, or Catalog data.
- The create endpoint now uses the server-only Supabase admin credential; the hardened RPC is granted only to `service_role`.

## Boundaries retained

- Recognition produces candidates only.
- Identity Persistence remains the only Product/User Asset writer.
- Rule Engine and Resolver are unchanged; verified knowledge and product-type fallback remain their existing inputs.
- Product Knowledge schema and tables are unchanged.

## Validation

- Forged external requests without a confirmation token fail schema validation.
- The migration defines a user-scoped idempotency record and idempotent creation function.
- The asset creation route emits a knowledge suggestion instead of calling the enrichment writer.
- Existing resolver behavior continues to ignore candidate knowledge for decision capabilities/roles.

## Deployment note

Apply `20260825000000_harden_identity_boundary.sql` before deploying this code. The server must have `SUPABASE_SERVICE_ROLE_KEY`, already used by trusted server-side workflows, configured.
