import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { findRequestSchema, toMongoFilter } from "@/lib/admin-find";

describe("findRequestSchema", () => {
  it("applies defaults for filter and limit", () => {
    const parsed = findRequestSchema.parse({ collection: "answers" });
    expect(parsed.filter).toEqual({});
    expect(parsed.limit).toBe(50);
  });

  it("accepts plain equality filters", () => {
    const parsed = findRequestSchema.parse({
      collection: "answers",
      filter: { userEmail: "zaking17@gmail.com", provider: "openai" },
      sort: { updatedAt: -1 },
      projection: { question: 1, model: 1 },
      limit: 5,
    });
    expect(parsed.filter.userEmail).toBe("zaking17@gmail.com");
  });

  it("rejects unknown collections", () => {
    expect(() =>
      findRequestSchema.parse({ collection: "users" }),
    ).toThrow();
  });

  it("rejects operator keys in filters", () => {
    expect(() =>
      findRequestSchema.parse({
        collection: "answers",
        filter: { $where: "1" },
      }),
    ).toThrow();
    expect(() =>
      findRequestSchema.parse({
        collection: "answers",
        filter: { "a.$.b": "x" },
      }),
    ).toThrow();
  });

  it("rejects non-scalar filter values (nested operators)", () => {
    expect(() =>
      findRequestSchema.parse({
        collection: "answers",
        filter: { aiText: { $ne: "" } },
      }),
    ).toThrow();
    expect(() =>
      findRequestSchema.parse({
        collection: "answers",
        filter: { provider: ["openai"] },
      }),
    ).toThrow();
  });

  it("rejects operator keys in projection and sort", () => {
    expect(() =>
      findRequestSchema.parse({
        collection: "answers",
        projection: { $slice: 1 },
      }),
    ).toThrow();
    expect(() =>
      findRequestSchema.parse({
        collection: "answers",
        sort: { $natural: 1 },
      }),
    ).toThrow();
  });

  it("caps the limit at 200", () => {
    expect(() =>
      findRequestSchema.parse({ collection: "answers", limit: 201 }),
    ).toThrow();
  });
});

describe("toMongoFilter", () => {
  it("converts a 24-hex _id string to an ObjectId", () => {
    const hex = "6a2b5a787afab16645a805fa";
    const filter = toMongoFilter({ _id: hex });
    expect(filter._id).toBeInstanceOf(ObjectId);
    expect((filter._id as ObjectId).toHexString()).toBe(hex);
  });

  it("leaves non-id and non-hex values untouched", () => {
    const filter = toMongoFilter({ _id: "not-an-id", provider: "openai" });
    expect(filter._id).toBe("not-an-id");
    expect(filter.provider).toBe("openai");
  });
});
