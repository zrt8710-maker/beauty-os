export class SkinConversationProviderError extends Error {
  readonly code = "SKIN_CONVERSATION_PROVIDER_FAILURE";

  constructor(message: string, readonly causeKind: "network" | "http" | "response") {
    super(message);
    this.name = "SkinConversationProviderError";
  }
}

export class SkinConversationInternalError extends Error {
  readonly code = "SKIN_CONVERSATION_INTERNAL_ERROR";

  constructor(message: string, readonly stage: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SkinConversationInternalError";
  }
}
