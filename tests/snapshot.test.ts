import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSnapshot, writeSnapshotAtomic } from "../src/lib/snapshot";

const temporaryPath = path.join("/tmp", `linear-site-test-${process.pid}.json`);
afterEach(async () => { await fs.rm(temporaryPath, { force: true }); });

describe("snapshot persistence", () => {
  it("writes a valid snapshot atomically", async () => {
    const fixture = await readSnapshot("tests/fixtures/snapshot.json");
    await writeSnapshotAtomic(fixture, temporaryPath);
    expect(await readSnapshot(temporaryPath)).toEqual(fixture);
    await expect(fs.access(`${temporaryPath}.${process.pid}.tmp`)).rejects.toThrow();
  });

  it("rejects invalid snapshots before replacing the destination", async () => {
    const fixture = await readSnapshot("tests/fixtures/snapshot.json");
    await writeSnapshotAtomic(fixture, temporaryPath);
    await expect(writeSnapshotAtomic({ ...fixture, schemaVersion: 2 } as never, temporaryPath)).rejects.toThrow();
    expect((await readSnapshot(temporaryPath)).schemaVersion).toBe(1);
  });
});

