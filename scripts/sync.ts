import { syncLinearSnapshot } from "../src/lib/linear/sync";

syncLinearSnapshot()
  .then((snapshot) => {
    console.log(
      `Synced ${Object.keys(snapshot.projects).length} projects and ${Object.keys(snapshot.issues).length} issues.`,
    );
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });

