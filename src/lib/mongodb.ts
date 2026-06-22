import { MongoClient } from "mongodb";

const globalForMongo = globalThis as typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise() {
  if (globalForMongo.mongoClientPromise) {
    return globalForMongo.mongoClientPromise;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  globalForMongo.mongoClientPromise = new MongoClient(uri).connect();

  return globalForMongo.mongoClientPromise;
}

export async function getDatabase() {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB ?? "brainshare");
}
