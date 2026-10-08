/** One turn of the per-file follow-up conversation with the mentor. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Diff fingerprint the turn was about; absent on unsent local turns. */
  fingerprint?: string;
}

/** Persisted conversation for one file of a run (`Run.conversations[path]`). */
export interface FileConversation {
  /** Fingerprint of the most recent turn; older turns keep their own. */
  fingerprint: string;
  messages: ChatMessage[];
  updatedAt: string;
}

/** Newest turns kept per file; older ones are dropped from the record. */
export const conversationMessageLimit = 20;
/** Characters kept per stored turn (the live answer is not shortened). */
export const conversationContentLimit = 8_000;
