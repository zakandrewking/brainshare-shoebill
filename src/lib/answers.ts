import { ObjectId, type WithId } from "mongodb";

import {
  attributeText,
  type AttributionSegment,
} from "@/lib/attribution";
import { getDatabase } from "@/lib/mongodb";
import type { SerializedAnswer } from "@/lib/types";

export type AnswerDocument = {
  userId: string;
  userEmail: string;
  question: string;
  aiText: string;
  currentText: string;
  segments: AttributionSegment[];
  provider: string;
  model: string;
  // Question embedding for related-question ranking; absent until computed
  // (created before the feature, or the embedding call failed). The question
  // never changes after creation, so the vector is written once per model.
  questionEmbedding?: number[] | null;
  embeddingModel?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeAnswer(
  answer: WithId<AnswerDocument>,
): SerializedAnswer {
  return {
    id: answer._id.toHexString(),
    userId: answer.userId,
    userEmail: answer.userEmail,
    question: answer.question,
    aiText: answer.aiText,
    currentText: answer.currentText,
    segments: answer.segments,
    provider: answer.provider,
    model: answer.model,
    createdAt: answer.createdAt.toISOString(),
    updatedAt: answer.updatedAt.toISOString(),
  };
}

async function answersCollection() {
  const database = await getDatabase();
  return database.collection<AnswerDocument>("answers");
}

export type RelatedCandidateDocument = {
  id: string;
  question: string;
  /** AI baseline text; embedded together with the question (see embeddingInput). */
  text: string;
  embedding: number[] | null;
  embeddingModel: string | null;
};

export async function createAnswer(
  answer: Omit<AnswerDocument, "segments" | "createdAt" | "updatedAt">,
) {
  const now = new Date();
  const document: AnswerDocument = {
    ...answer,
    segments: attributeText(answer.aiText, answer.currentText),
    createdAt: now,
    updatedAt: now,
  };
  const collection = await answersCollection();
  const result = await collection.insertOne(document);

  return serializeAnswer({ ...document, _id: result.insertedId });
}

export async function listAnswers(userId: string) {
  const collection = await answersCollection();
  const documents = await collection
    .find({ userId })
    .sort({ updatedAt: -1 })
    .toArray();

  return documents.map(serializeAnswer);
}

// Lean projection for related-question ranking: ids, questions, and stored
// embeddings only — full documents (and their vectors) never reach the client.
export async function listRelatedCandidates(
  userId: string,
): Promise<RelatedCandidateDocument[]> {
  const collection = await answersCollection();
  const documents = await collection
    .find(
      { userId },
      {
        projection: {
          question: 1,
          aiText: 1,
          questionEmbedding: 1,
          embeddingModel: 1,
        },
      },
    )
    .sort({ updatedAt: -1 })
    .toArray();

  return documents.map((document) => ({
    id: document._id.toHexString(),
    question: document.question,
    text: document.aiText,
    embedding: document.questionEmbedding ?? null,
    embeddingModel: document.embeddingModel ?? null,
  }));
}

// Lazy backfill: answers created before embeddings existed (or whose vector
// came from a different model) get re-embedded by the related endpoint.
export async function setQuestionEmbedding(
  id: string,
  userId: string,
  embedding: number[],
  embeddingModel: string,
) {
  if (!ObjectId.isValid(id)) {
    return;
  }

  const collection = await answersCollection();
  await collection.updateOne(
    { _id: new ObjectId(id), userId },
    { $set: { questionEmbedding: embedding, embeddingModel } },
  );
}

export async function updateAnswer(
  id: string,
  userId: string,
  currentText: string,
) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const collection = await answersCollection();
  const existing = await collection.findOne({
    _id: new ObjectId(id),
    userId,
  });

  if (!existing) {
    return null;
  }

  const updatedAt = new Date();
  const segments = attributeText(existing.aiText, currentText);
  await collection.updateOne(
    { _id: existing._id, userId },
    { $set: { currentText, segments, updatedAt } },
  );

  return serializeAnswer({
    ...existing,
    currentText,
    segments,
    updatedAt,
  });
}

export async function regenerateAnswer(
  id: string,
  userId: string,
  aiText: string,
  provider: string,
  model: string,
) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const collection = await answersCollection();
  const existing = await collection.findOne({
    _id: new ObjectId(id),
    userId,
  });

  if (!existing) {
    return null;
  }

  // Overwrite in place: replace the AI baseline, reset the user's edits back to
  // that baseline, and recompute attribution. Keep the same id, question, and
  // createdAt so the submission stays addressable. The stored embedding covers
  // question+answer text, so a new baseline invalidates it (re-embedded lazily).
  const updatedAt = new Date();
  const segments = attributeText(aiText, aiText);
  await collection.updateOne(
    { _id: existing._id, userId },
    {
      $set: {
        aiText,
        currentText: aiText,
        segments,
        provider,
        model,
        questionEmbedding: null,
        embeddingModel: null,
        updatedAt,
      },
    },
  );

  return serializeAnswer({
    ...existing,
    aiText,
    currentText: aiText,
    segments,
    provider,
    model,
    updatedAt,
  });
}

export async function deleteAnswer(id: string, userId: string) {
  if (!ObjectId.isValid(id)) {
    return false;
  }

  const collection = await answersCollection();
  const result = await collection.deleteOne({
    _id: new ObjectId(id),
    userId,
  });

  return result.deletedCount === 1;
}
