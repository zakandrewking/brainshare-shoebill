// Persistence + refill orchestration for the starter-suggestion pool.

import { ObjectId } from "mongodb";

import { getDatabase } from "@/lib/mongodb";
import { generateSuggestionBatch } from "@/lib/suggestions-gen";
import {
  MAX_SUGGESTION_GENERATIONS_PER_DAY,
  MIN_SUGGESTION_REFILL_INTERVAL_MS,
  SUGGESTION_POOL_TARGET,
  shouldRefill,
  utcDay,
  type SuggestionBudget,
} from "@/lib/suggestions";

type SuggestionDoc = {
  userId: string;
  text: string;
  status: "ready" | "used" | "dismissed";
  createdAt: Date;
};

type BudgetDoc = {
  userId: string;
  day: string;
  generationsToday: number;
  lastGeneratedAt: Date;
};

export type SerializedSuggestion = { id: string; text: string };

async function suggestionsCollection() {
  const database = await getDatabase();
  return database.collection<SuggestionDoc>("suggestions");
}

async function budgetCollection() {
  const database = await getDatabase();
  const collection = database.collection<BudgetDoc>("suggestionBudget");
  // Unique per user so the atomic claim (findOneAndUpdate/upsert) can't create
  // duplicate budget docs under concurrent refills. Idempotent + cached.
  await collection.createIndex({ userId: 1 }, { unique: true }).catch(() => {});
  return collection;
}

export async function listReadySuggestions(
  userId: string,
  limit = SUGGESTION_POOL_TARGET,
): Promise<SerializedSuggestion[]> {
  const collection = await suggestionsCollection();
  const docs = await collection
    .find({ userId, status: "ready" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  return docs.map((doc) => ({ id: doc._id.toHexString(), text: doc.text }));
}

/** Mark a ready suggestion used or dismissed. Returns true if one changed. */
export async function consumeSuggestion(
  userId: string,
  id: string,
  status: "used" | "dismissed",
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const collection = await suggestionsCollection();
  const result = await collection.updateOne(
    { _id: new ObjectId(id), userId, status: "ready" },
    { $set: { status } },
  );
  return result.modifiedCount === 1;
}

async function readBudget(userId: string): Promise<SuggestionBudget> {
  const collection = await budgetCollection();
  const doc = await collection.findOne({ userId });
  if (!doc) {
    return { day: "", generationsToday: 0, lastGeneratedAt: new Date(0) };
  }
  return {
    day: doc.day,
    generationsToday: doc.generationsToday,
    lastGeneratedAt: doc.lastGeneratedAt,
  };
}

/**
 * Atomically reserve a generation slot for `userId`. Returns true only if the
 * caller is permitted to generate *right now* — enforcing both the daily cap
 * and the debounce in a single conditional update, so concurrent refills can't
 * double-spend. Resets the counter when the UTC day rolls over.
 */
async function claimGeneration(userId: string, now: Date): Promise<boolean> {
  const collection = await budgetCollection();
  const today = utcDay(now);
  const cutoff = new Date(now.getTime() - MIN_SUGGESTION_REFILL_INTERVAL_MS);

  // Seed a doc if absent (pure-equality upsert; unique index keeps it single).
  await collection
    .updateOne(
      { userId },
      {
        $setOnInsert: {
          userId,
          day: today,
          generationsToday: 0,
          lastGeneratedAt: new Date(0),
        },
      },
      { upsert: true },
    )
    .catch(() => {});

  // Claim iff: a new day (reset to 1) OR same day, under the cap, past debounce.
  const claimed = await collection.findOneAndUpdate(
    {
      userId,
      $or: [
        { day: { $ne: today } },
        {
          day: today,
          generationsToday: { $lt: MAX_SUGGESTION_GENERATIONS_PER_DAY },
          lastGeneratedAt: { $lt: cutoff },
        },
      ],
    },
    [
      {
        $set: {
          day: today,
          generationsToday: {
            $cond: [
              { $eq: ["$day", today] },
              { $add: ["$generationsToday", 1] },
              1,
            ],
          },
          lastGeneratedAt: now,
        },
      },
    ],
    { returnDocument: "after" },
  );

  return claimed !== null;
}

// Recent question texts to steer generation away from duplicates: the user's
// existing answers plus the currently-pooled suggestions.
async function existingQuestions(userId: string): Promise<string[]> {
  const database = await getDatabase();
  const answers = await database
    .collection("answers")
    .find({ userId }, { projection: { question: 1 } })
    .sort({ updatedAt: -1 })
    .limit(40)
    .toArray();
  const pooled = await listReadySuggestions(userId, 50);
  return [
    ...answers.map((a) => String(a.question ?? "")),
    ...pooled.map((s) => s.text),
  ].filter(Boolean);
}

/**
 * Top the pool back up to target if policy + budget allow. Safe to call on
 * every GET/consume (fire-and-forget via `after()`): it no-ops cheaply when the
 * pool is full, the daily cap is hit, or a refill ran within the debounce.
 */
export async function refillSuggestionsIfNeeded(userId: string): Promise<void> {
  try {
    const now = new Date();
    const ready = await listReadySuggestions(userId, SUGGESTION_POOL_TARGET);
    const budget = await readBudget(userId);
    if (!shouldRefill(ready.length, budget, now)) return;

    // Atomic gate — also the real enforcement of cap + debounce.
    if (!(await claimGeneration(userId, now))) return;

    const batch = await generateSuggestionBatch(
      await existingQuestions(userId),
    );
    if (batch.length === 0) return;

    const collection = await suggestionsCollection();
    await collection.insertMany(
      batch.map((text) => ({
        userId,
        text,
        status: "ready" as const,
        createdAt: new Date(),
      })),
    );
  } catch (error) {
    console.error("[refillSuggestionsIfNeeded] failed:", error);
  }
}
