import { describe, expect, it } from "vitest";

import { isServiceToken } from "@/lib/service-token";

const TOKEN = "a".repeat(64);

describe("isServiceToken", () => {
  it("rejects everything when no token is configured", () => {
    expect(isServiceToken(TOKEN, undefined)).toBe(false);
    expect(isServiceToken("", undefined)).toBe(false);
  });

  it("rejects a configured token shorter than 32 characters", () => {
    const short = "a".repeat(31);
    expect(isServiceToken(short, short)).toBe(false);
  });

  it("accepts an exact match of a sufficiently long token", () => {
    expect(isServiceToken(TOKEN, TOKEN)).toBe(true);
  });

  it("rejects a same-length mismatch", () => {
    expect(isServiceToken("b".repeat(64), TOKEN)).toBe(false);
  });

  it("rejects prefixes and extensions of the token", () => {
    expect(isServiceToken(TOKEN.slice(0, 40), TOKEN)).toBe(false);
    expect(isServiceToken(TOKEN + "a", TOKEN)).toBe(false);
  });
});
