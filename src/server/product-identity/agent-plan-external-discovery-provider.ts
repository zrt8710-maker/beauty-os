import "server-only";
import type { ExternalProductIdentity } from "@/schemas/product-identity-resolution";
import type { ExternalProductDiscoveryProvider } from "./product-identity-provider";
import type { IdentityDiscoveryProvider } from "./volcengine-identity-discovery-provider";
export class ExternalProductDiscoveryUnavailableError extends Error {
  constructor() { super("EXTERNAL_PRODUCT_DISCOVERY_UNAVAILABLE"); this.name = "ExternalProductDiscoveryUnavailableError"; }
}

export function createAgentPlanExternalDiscoveryProvider(provider: IdentityDiscoveryProvider): ExternalProductDiscoveryProvider {
  return { providerCode:"volcengine_agent_plan", async discover({ clue, search_results }):Promise<ExternalProductIdentity[]> {
    const barcode=clue.observed_text.find((item)=>item.type==="barcode")?.value?.trim() ?? null;
    const result=await provider.discover({source:clue.source,raw_query:clue.raw_query,brand_hint:clue.brand_name,product_name_hint:clue.product_name,barcode_hint:barcode,observed_text:clue.observed_text,recognition_confidence:clue.recognition_confidence,search_results});
    if(result.status==="unavailable")throw new ExternalProductDiscoveryUnavailableError();
    if(result.status==="unresolved")return [];
    return result.candidates.map(candidate=>({brand_name:candidate.brand_name,product_name:candidate.product_name,variant_name:candidate.variant_name,barcode:candidate.barcode,product_type:null,image_url:null,image_source_url:null,source_reference:{provider:"volcengine_agent_plan",display_name:candidate.short_descriptor??candidate.product_name,source_name:candidate.sources[0]?.title??"Web source",url:candidate.sources[0]?.url??null},discovery_metadata:{aliases:candidate.aliases,confidence:candidate.confidence,sources:candidate.sources,uncertainties:candidate.uncertainties},confirmation_token:null,confirmation_id:null}));
  }};
}
