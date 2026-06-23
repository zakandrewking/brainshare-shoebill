import { getDatabase } from "./mongodb";

export type UserSettings = {
  userId: string;
  driveRefreshToken?: string;
  driveFileId?: string;
  driveLastSyncAt?: Date;
  driveTokenInvalid?: boolean;
};

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const db = await getDatabase();
  const doc = await db
    .collection<UserSettings>("userSettings")
    .findOne({ userId });
  return doc ?? { userId };
}

export async function upsertUserSettings(
  userId: string,
  set: Partial<Omit<UserSettings, "userId">>,
): Promise<void> {
  const db = await getDatabase();
  await db
    .collection<UserSettings>("userSettings")
    .updateOne({ userId }, { $set: set }, { upsert: true });
}

export async function unsetUserSettings(
  userId: string,
  fields: (keyof Omit<UserSettings, "userId">)[],
): Promise<void> {
  const db = await getDatabase();
  const unset = Object.fromEntries(fields.map((f) => [f, 1 as const]));
  await db
    .collection<UserSettings>("userSettings")
    .updateOne({ userId }, { $unset: unset });
}
