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
  // Absent or "done" means the answer is fully saved.
  generationStatus?: GenerationStatus;
  // Partial text accumulated so far (only present while generationStatus is
  // "generating"); excluded from list responses to keep payloads small.
  generatingText?: string;
  generatingStartedAt?: string;
  createdAt: string;
  updatedAt: string;
};
