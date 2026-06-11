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
