import type { AttributionSegment } from "@/lib/attribution";

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
  createdAt: string;
  updatedAt: string;
};
