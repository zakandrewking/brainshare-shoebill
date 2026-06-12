import { timingSafeEqual } from "node:crypto";

// Tokens shorter than this are treated as unconfigured so a weak or empty
// SERVICE_API_TOKEN can never open the API.
const MIN_TOKEN_LENGTH = 32;

export function isServiceToken(
  candidate: string,
  expected = process.env.SERVICE_API_TOKEN,
) {
  if (!expected || expected.length < MIN_TOKEN_LENGTH) {
    return false;
  }

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);

  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}
