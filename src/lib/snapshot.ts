import fs from "node:fs/promises";
import path from "node:path";
import { SNAPSHOT_PATH } from "./constants";
import { publicSnapshotSchema, type PublicSnapshot } from "./schema";

export async function readSnapshot(
  snapshotPath = process.env.LINEAR_SNAPSHOT_PATH ?? SNAPSHOT_PATH,
): Promise<PublicSnapshot> {
  const absolutePath = path.resolve(snapshotPath);
  let contents: string;
  try {
    contents = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No Linear snapshot found at ${absolutePath}. Run \"npm run sync\" first.`,
      );
    }
    throw error;
  }
  return publicSnapshotSchema.parse(JSON.parse(contents));
}

export async function writeSnapshotAtomic(
  snapshot: PublicSnapshot,
  snapshotPath = SNAPSHOT_PATH,
): Promise<void> {
  const validated = publicSnapshotSchema.parse(snapshot);
  const absolutePath = path.resolve(snapshotPath);
  const directory = path.dirname(absolutePath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporaryPath, absolutePath);
}
