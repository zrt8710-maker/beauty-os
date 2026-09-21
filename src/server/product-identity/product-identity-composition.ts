import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createProductIdentityMatcher } from "@/server/services/product-identity-matching-service";
import { createInternalCatalogIdentityProvider } from "./internal-catalog-identity-provider";
import { createProductIdentityAgent } from "./product-identity-agent";
import { createAgentPlanExternalDiscoveryProvider } from "./agent-plan-external-discovery-provider";
import { createConfiguredVolcengineIdentityDiscoveryProvider } from "./volcengine-identity-discovery-provider";
import { createConfiguredVolcengineSearchInfinityProvider } from "@/server/product-search/volcengine-search-infinity-provider";
import type { ProductIdentityTimingReporter } from "./identity-research-debug";

export async function createRequestProductIdentityAgent(timingReporter?: ProductIdentityTimingReporter) {
  const supabase = createAdminClient();
  const discoveryProvider = createConfiguredVolcengineIdentityDiscoveryProvider();
  return createProductIdentityAgent(
    createInternalCatalogIdentityProvider(
      createProductIdentityMatcher(createCatalogIdentityRepository(supabase), timingReporter),
    ),
    discoveryProvider
      ? createAgentPlanExternalDiscoveryProvider(discoveryProvider)
      : {
      // Product Research is intentionally not implemented in Cleanup v0.1.
      // Keep Identity's future extension point without reviving the retired
      // The retired discovery pipeline is intentionally not invoked here.
      providerCode: "future_product_research",
      async discover() {
        return [];
      },
    },
    createConfiguredVolcengineSearchInfinityProvider({
      onTiming: (stage, elapsed_ms) => timingReporter?.({ stage, elapsed_ms }),
    }),
  );
}
