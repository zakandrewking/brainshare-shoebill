import type { AttributionSegment } from "@/lib/attribution";

export type GenerationStatus = "generating" | "done" | "error" | "cancelled";

export type SerializedAnswer = {
  id: string;
  userId: string;
  userEmail: string;
  question: string;
  aiText: string;
  currentText: string;
  segments: AttributionSegment[];
  provider: string;
  model: string;
  // The model's reasoning summary ("thinking"), persisted so the Thinking
  // panel is available even after a reload. Absent for answers generated
  // before reasoning was captured, or when the model returned none.
  reasoning?: string;
  // Absent or "done" means the answer is fully saved.
  generationStatus?: GenerationStatus;
  // Partial text/reasoning accumulated so far (only present while
  // generationStatus is "generating"); excluded from list responses.
  generatingText?: string;
  generatingReasoning?: string;
  generatingStartedAt?: string;
  createdAt: string;
  updatedAt: string;
};
