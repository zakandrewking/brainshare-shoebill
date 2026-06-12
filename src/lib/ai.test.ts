import { afterEach, describe, expect, it } from "vitest";

import {
  ANSWER_STREAM_CONTENT_TYPE,
  streamAnswer,
  type AnswerStreamEvent,
} from "./ai";

async function collectEvents(response: Response): Promise<AnswerStreamEvent[]> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AnswerStreamEvent);
}

describe("streamAnswer (mock provider)", () => {
  const originalProvider = process.env.AI_PROVIDER;

  afterEach(() => {
    process.env.AI_PROVIDER = originalProvider;
  });

  it("streams reasoning then text as newline-delimited JSON", async () => {
    process.env.AI_PROVIDER = "mock";

    const response = streamAnswer("What is truth?");
    expect(response.headers.get("content-type")).toBe(
      ANSWER_STREAM_CONTENT_TYPE,
    );

    const events = await collectEvents(response);
    const kinds = events.map((event) => event.t);

    // The model "thinks" before it writes, so reasoning leads the text.
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("text");
    expect(kinds.indexOf("reasoning")).toBeLessThan(kinds.indexOf("text"));

    const answer = events
      .filter((event) => event.t === "text")
      .map((event) => event.v)
      .join("");
    expect(answer).toContain("What is truth?");
  });
});
