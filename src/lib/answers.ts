import { ObjectId, type WithId } from "mongodb";

import {
  attributeText,
  type AttributionSegment,
} from "@/lib/attribution";
import { getDatabase } from "@/lib/mongodb";
import type { GenerationStatus, SerializedAnswer } from "@/lib/types";
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
  // Persisted reasoning summary ("thinking") for the Thinking panel.
  reasoning?: string;
  // Bounded revert history (see lib/versioning); excluded from list payloads.
  versions?: AnswerVersion[];
  // Background generation state. Absent or "done" = fully saved.
  generationStatus?: GenerationStatus;
  generatingText?: string;
  generatingReasoning?: string;
  generatingStartedAt?: Date;
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
  includeGeneratingText = false,
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
    ...(answer.reasoning !== undefined ? { reasoning: answer.reasoning } : {}),
    generationStatus: answer.generationStatus,
    ...(includeGeneratingText && answer.generatingText !== undefined
      ? { generatingText: answer.generatingText }
      : {}),
    ...(includeGeneratingText && answer.generatingReasoning !== undefined
      ? { generatingReasoning: answer.generatingReasoning }
      : {}),
    ...(answer.generatingStartedAt
      ? { generatingStartedAt: answer.generatingStartedAt.toISOString() }
      : {}),
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

/** Create a placeholder answer that will be populated by a background job. */
export async function createAnswerGenerating(params: {
  userId: string;
  userEmail: string;
  question: string;
  provider: string;
  model: string;
}) {
  const now = new Date();
  const document: AnswerDocument = {
    ...params,
    aiText: "",
    currentText: "",
    segments: [],
    generationStatus: "generating",
    generatingText: "",
    generatingReasoning: "",
    generatingStartedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const collection = await answersCollection();
  const result = await collection.insertOne(document);
  return serializeAnswer({ ...document, _id: result.insertedId });
}

/** Return a single answer (including partial generatingText for polling). */
export async function getAnswer(
  id: string,
  userId: string,
): Promise<SerializedAnswer | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await answersCollection();
  const document = await collection.findOne(
    { _id: new ObjectId(id), userId },
    { projection: { versions: 0 } },
  );
  if (!document) return null;
  return serializeAnswer(document, true);
}

/** Update the partial text + reasoning accumulated so far (polled by clients). */
export async function setGeneratingProgress(
  id: string,
  userId: string,
  text: string,
  reasoning: string,
) {
  if (!ObjectId.isValid(id)) return;
  const collection = await answersCollection();
  await collection.updateOne(
    { _id: new ObjectId(id), userId },
    { $set: { generatingText: text, generatingReasoning: reasoning } },
  );
}

/** Peek at the current generation status (used by background job for cancel checks). */
export async function getAnswerGenerationStatus(
  id: string,
  userId: string,
): Promise<GenerationStatus | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await answersCollection();
  const doc = await collection.findOne(
    { _id: new ObjectId(id), userId },
    { projection: { generationStatus: 1 } },
  );
  return doc?.generationStatus ?? null;
}

/** Finalise a brand-new answer after background generation completes. */
export async function completeAnswerGeneration(
  id: string,
  userId: string,
  aiText: string,
  reasoning: string,
  provider: string,
  model: string,
  questionEmbedding: number[] | null,
  embeddingModel: string | null,
) {
  if (!ObjectId.isValid(id)) return;
  const collection = await answersCollection();
  const now = new Date();
  const segments = attributeText(aiText, aiText);
  await collection.updateOne(
    { _id: new ObjectId(id), userId },
    {
      $set: {
        aiText,
        currentText: aiText,
        segments,
        reasoning,
        provider,
        model,
        questionEmbedding,
        embeddingModel,
        generationStatus: "done",
        updatedAt: now,
      },
      $unset: {
        generatingText: "",
        generatingReasoning: "",
        generatingStartedAt: "",
      },
    },
  );
}

/** Mark existing answer as generating (snapshot first), then fill via background job. */
export async function markAnswerRegenerating(
  id: string,
  userId: string,
): Promise<AnswerDocument | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await answersCollection();
  const existing = await collection.findOne({ _id: new ObjectId(id), userId });
  if (!existing) return null;
  const now = new Date();
  await collection.updateOne(
    { _id: new ObjectId(id), userId },
    {
      $set: {
        generationStatus: "generating",
        generatingText: "",
        generatingStartedAt: now,
        updatedAt: now,
      },
      $push: {
        versions: {
          $each: [snapshotOf(existing, "regenerate", now)],
          $slice: -MAX_VERSIONS,
        },
      },
    },
  );
  return existing;
}

/** Finalise a regenerated answer after background job completes. */
export async function completeAnswerRegeneration(
  id: string,
  userId: string,
  aiText: string,
  currentText: string,
  reasoning: string,
  provider: string,
  model: string,
) {
  if (!ObjectId.isValid(id)) return;
  const collection = await answersCollection();
  const now = new Date();
  const segments = attributeText(aiText, currentText);
  await collection.updateOne(
    { _id: new ObjectId(id), userId },
    {
      $set: {
        aiText,
        currentText,
        segments,
        reasoning,
        provider,
        model,
        questionEmbedding: null,
        embeddingModel: null,
        generationStatus: "done",
        updatedAt: now,
      },
      $unset: {
        generatingText: "",
        generatingReasoning: "",
        generatingStartedAt: "",
      },
    },
  );
}

/** Mark a background generation as failed. */
export async function failAnswerGeneration(id: string, userId: string) {
  if (!ObjectId.isValid(id)) return;
  const collection = await answersCollection();
  await collection.updateOne(
    { _id: new ObjectId(id), userId },
    {
      $set: { generationStatus: "error" },
      $unset: {
        generatingText: "",
        generatingReasoning: "",
        generatingStartedAt: "",
      },
    },
  );
}

/** Cancel a running background generation. Returns true if the doc was found. */
export async function cancelAnswerGeneration(
  id: string,
  userId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const collection = await answersCollection();
  const result = await collection.updateOne(
    { _id: new ObjectId(id), userId, generationStatus: "generating" },
    {
      $set: { generationStatus: "cancelled" },
      $unset: {
        generatingText: "",
        generatingReasoning: "",
        generatingStartedAt: "",
      },
    },
  );
  return result.matchedCount > 0;
}

export async function listAnswers(userId: string) {
  const collection = await answersCollection();
  const documents = await collection
    .find(
      { userId },
      {
        projection: {
          versions: 0,
          questionEmbedding: 0,
          generatingText: 0,
          generatingReasoning: 0,
        },
      },
    )
    .sort({ updatedAt: -1 })
    .toArray();

  return documents.map((doc) => serializeAnswer(doc));
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

/**
 * Apply an idea-relink result: replace the text with the relinked version
 * (cross-links woven into the prose), recompute attribution from the new
 * baseline, snapshot the pre-relink state so it stays revertible, and invalidate
 * the embedding (the text changed, so the stored vector lazily re-embeds).
 * Returns null when nothing changed (so callers can skip a pointless write).
 */
export async function applyRelink(
  id: string,
  userId: string,
  aiText: string,
  currentText: string,
) {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  const collection = await answersCollection();
  const existing = await collection.findOne({ _id: new ObjectId(id), userId });
  if (!existing) {
    return null;
  }
  if (existing.aiText === aiText && existing.currentText === currentText) {
    return serializeAnswer(existing);
  }

  const updatedAt = new Date();
  const segments = attributeText(aiText, currentText);
  await collection.updateOne(
    { _id: existing._id, userId },
    {
      $set: {
        aiText,
        currentText,
        segments,
        questionEmbedding: null,
        embeddingModel: null,
        updatedAt,
      },
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
    currentText,
    segments,
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
