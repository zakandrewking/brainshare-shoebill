import { ObjectId, type Document, type Filter } from "mongodb";
import { z } from "zod";

// Field names may address nested paths ("a.b") but never Mongo operators, so
// the endpoint stays equality-only and read-only by construction.
const safeFieldName = z
  .string()
  .min(1)
  .max(200)
  .refine((key) => !key.includes("$") && !key.includes("\0"), {
    message: "Field names must not contain '$'.",
  });

const plainValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const findRequestSchema = z.object({
  collection: z.enum(["answers"]),
  filter: z.record(safeFieldName, plainValue).default({}),
  projection: z
    .record(safeFieldName, z.union([z.literal(0), z.literal(1)]))
    .optional(),
  sort: z
    .record(safeFieldName, z.union([z.literal(1), z.literal(-1)]))
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type FindRequest = z.infer<typeof findRequestSchema>;

export function toMongoFilter(filter: FindRequest["filter"]): Filter<Document> {
  // A 24-hex `_id` is converted so callers can look documents up by the
  // serialized id the API returns.
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    result[key] =
      key === "_id" && typeof value === "string" && ObjectId.isValid(value)
        ? new ObjectId(value)
        : value;
  }
  return result;
}
