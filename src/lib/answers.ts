import { ObjectId, type WithId } from "mongodb";

import {
  attributeText,
  type AttributionSegment,
} from "@/lib/attribution";
import { getDatabase } from "@/lib/mongodb";
import type { SerializedAnswer } from "@/lib/types";
import {
  MAX_VERSIONS,
  shouldSnapshotBeforeEdit,
  type AnswerVersion,
  type VersionKind,
} from "@/lib/versioning";

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
  // Bounded revert history (see lib/versioning); excluded from list payloads.
  versions?: AnswerVersion[];
  createdAt: Date;
  updatedAt: Date;
};

// Snapshot of the state an operation is about to displace.
function snapshotOf(
  existing: AnswerDocument,
  kind: VersionKind,
  capturedAt: Date,
): AnswerVersion {
  return {
    kind,
    aiText: existing.aiText,
    currentText: existing.currentText,
    provider: existing.provider,
    model: existing.model,
    stateUpdatedAt: existing.updatedAt,
    capturedAt,
  };
}

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
    .find({ userId }, { projection: { versions: 0 } })
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
  // Checkpoint the pre-edit state, coalesced so autosave doesn't spam one
  // snapshot per keystroke pause.
  const snapshot = shouldSnapshotBeforeEdit(existing.versions, updatedAt)
    ? snapshotOf(existing, "edit", updatedAt)
    : null;
  await collection.updateOne(
    { _id: existing._id, userId },
    {
      $set: { currentText, segments, updatedAt },
      ...(snapshot
        ? { $push: { versions: { $each: [snapshot], $slice: -MAX_VERSIONS } } }
        : {}),
    },
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
  currentText?: string,
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

  // Overwrite in place: replace the AI baseline and recompute attribution.
  // `currentText` carries the author's preserved passages woven into the new
  // baseline (lib/reinject) — the diff re-credits them to the user; without
  // it, edits reset to the fresh baseline. Keep the same id, question, and
  // createdAt so the submission stays addressable. The stored embedding covers
  // question+answer text, so a new baseline invalidates it (re-embedded lazily).
  const nextCurrentText = currentText ?? aiText;
  const updatedAt = new Date();
  const segments = attributeText(aiText, nextCurrentText);
  await collection.updateOne(
    { _id: existing._id, userId },
    {
      $set: {
        aiText,
        currentText: nextCurrentText,
        segments,
        provider,
        model,
        questionEmbedding: null,
        embeddingModel: null,
        updatedAt,
      },
      // The pre-regenerate state is always worth a revert point.
      $push: {
        versions: {
          $each: [snapshotOf(existing, "regenerate", updatedAt)],
          $slice: -MAX_VERSIONS,
        },
      },
    },
  );

  return serializeAnswer({
    ...existing,
    aiText,
    currentText: nextCurrentText,
    segments,
    provider,
    model,
    updatedAt,
  });
}

export type SerializedAnswerVersion = {
  index: number;
  kind: AnswerVersion["kind"];
  aiText: string;
  currentText: string;
  provider: string;
  model: string;
  stateUpdatedAt: string;
  capturedAt: string;
};

export async function listAnswerVersions(
  id: string,
  userId: string,
): Promise<SerializedAnswerVersion[] | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const collection = await answersCollection();
  const document = await collection.findOne(
    { _id: new ObjectId(id), userId },
    { projection: { versions: 1 } },
  );
  if (!document) {
    return null;
  }

  return (document.versions ?? []).map((version, index) => ({
    index,
    kind: version.kind,
    aiText: version.aiText,
    currentText: version.currentText,
    provider: version.provider,
    model: version.model,
    stateUpdatedAt: new Date(version.stateUpdatedAt).toISOString(),
    capturedAt: new Date(version.capturedAt).toISOString(),
  }));
}

/**
 * Swap a stored version back in. The displaced (current) state is snapshotted
 * first, so a revert is itself revertible. Attribution is recomputed from the
 * restored pair and the embedding invalidated (the baseline may change).
 */
export async function revertAnswer(id: string, userId: string, index: number) {
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

  const version = existing.versions?.[index];
  if (!version) {
    return null;
  }

  const updatedAt = new Date();
  const segments = attributeText(version.aiText, version.currentText);
  await collection.updateOne(
    { _id: existing._id, userId },
    {
      $set: {
        aiText: version.aiText,
        currentText: version.currentText,
        segments,
        provider: version.provider,
        model: version.model,
        questionEmbedding: null,
        embeddingModel: null,
        updatedAt,
      },
      $push: {
        versions: {
          $each: [snapshotOf(existing, "revert", updatedAt)],
          $slice: -MAX_VERSIONS,
        },
      },
    },
  );

  return serializeAnswer({
    ...existing,
    aiText: version.aiText,
    currentText: version.currentText,
    segments,
    provider: version.provider,
    model: version.model,
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
