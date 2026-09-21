import type { SkinConversationRequest, SkinConversationModelOutput } from "@/schemas/skin-conversation";
import { SkinConversationProviderError } from "./errors";

/** A stateless model boundary. Implementations must not use provider memory. */
export interface SkinConversationProvider {
  providerCode: string;
  model: string;
  extract(input: SkinConversationRequest, callbacks?: SkinConversationProviderCallbacks): Promise<SkinConversationModelOutput>;
}

/** Request-local presentation and timing hooks. Provider event shapes remain private. */
export type SkinConversationProviderCallbacks = {
  onReplyDelta?: (delta: string) => void;
  context_assembly?: () => void;
  provider_request_started?: () => void;
  provider_first_event?: () => void;
  provider_completed?: () => void;
};

export class SkinConversationProviderUnavailableError extends Error {
  constructor(message = "Skin conversation provider unavailable.") {
    super(message);
    this.name = "SkinConversationProviderUnavailableError";
  }
}

export { SkinConversationProviderError };
