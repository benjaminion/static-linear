import { describe, expect, it, vi } from "vitest";
import { LinearGraphQLClient } from "../src/lib/linear/client";
import { syncLinearSnapshot } from "../src/lib/linear/sync";
import type { RawDocument, RawProject } from "../src/lib/linear/normalize";

const done = { hasNextPage: false, endCursor: null };
const status = { name: "In Progress", type: "started", color: "#123456" };

function document(id: string, slugId: string, sortOrder: number): RawDocument {
  return {
    id,
    title: id,
    content: `Content for ${id}`,
    slugId,
    url: `https://linear.app/acme/document/${id}-${slugId}`,
    archivedAt: null,
    updatedAt: "2026-01-02T00:00:00Z",
    sortOrder,
  };
}

function project(): RawProject {
  return {
    id: "project-1",
    name: "Project",
    slugId: "project",
    url: "https://linear.app/acme/project/project",
    description: "Project",
    content: null,
    status,
    projectMilestones: { nodes: [], pageInfo: done },
    documents: { nodes: [], pageInfo: done },
    externalLinks: { nodes: [], pageInfo: done },
  };
}

function clientWithResources(exportFailure?: Error) {
  const first = document("doc-first", "aaaaaaaaaaaa", 10);
  const second = document("doc-second", "bbbbbbbbbbbb", 20);
  const linked = document("doc-linked", "cccccccccccc", 0);
  const request = vi.fn(async (_query: string, _variables: Record<string, unknown>, operationName?: string) => {
    switch (operationName) {
      case "PublicInitiative":
        return {
          initiative: {
            id: "initiative-1",
            name: "Initiative",
            url: "https://linear.app/acme/initiative/one",
            status: "Active",
            content: "Read [second](https://linear.app/acme/document/doc-second-bbbbbbbbbbbb).",
            organization: { urlKey: "acme" },
            documents: { nodes: [first], pageInfo: { hasNextPage: true, endCursor: "doc-next" } },
            links: {
              nodes: [{
                id: "link-doc",
                label: "Linked document",
                url: "https://linear.app/acme/document/doc-linked-cccccccccccc",
                archivedAt: null,
                sortOrder: 15,
              }],
              pageInfo: done,
            },
            projects: { nodes: [project()], pageInfo: done },
          },
        };
      case "PublicIssues": return { issues: { nodes: [], pageInfo: done } };
      case "PublicInitiativeResources": return {
        initiative: {
          documents: { nodes: [first], pageInfo: { hasNextPage: true, endCursor: "doc-next" } },
          links: {
            nodes: [{
              id: "link-doc",
              label: "Linked document",
              url: "https://linear.app/acme/document/doc-linked-cccccccccccc",
              archivedAt: null,
              sortOrder: 15,
            }],
            pageInfo: done,
          },
        },
      };
      case "PublicProjectResources": return {
        project: { documents: { nodes: [], pageInfo: done }, externalLinks: { nodes: [], pageInfo: done } },
      };
      case "PublicInitiativeDocuments": return { initiative: { documents: { nodes: [second], pageInfo: done } } };
      case "ExportLinearDocument":
        if (exportFailure) throw exportFailure;
        return { document: linked };
      default: throw new Error(`Unexpected operation ${operationName}`);
    }
  });
  return { request };
}

describe("Linear resource sync", () => {
  it("paginates attached documents, resolves Linear link resources, and rewrites prose", async () => {
    const client = clientWithResources();
    const snapshot = await syncLinearSnapshot({
      apiKey: "test-key",
      initiativeId: "initiative-1",
      client: client as unknown as LinearGraphQLClient,
      write: false,
    });

    expect(Object.keys(snapshot.documents)).toEqual(["doc-first", "doc-second", "doc-linked"]);
    expect(snapshot.initiative.resources.map((resource) => resource.type === "document" ? resource.documentId : resource.id)).toEqual([
      "doc-first",
      "doc-linked",
      "doc-second",
    ]);
    expect(snapshot.initiative.descriptionHtml).toContain('href="/documents/doc-second/"');
    expect(client.request).toHaveBeenCalledWith(expect.any(String), { id: "initiative-1", after: "doc-next" }, "PublicInitiativeDocuments");
    expect(client.request).toHaveBeenCalledWith(expect.any(String), { id: "doc-linked-cccccccccccc" }, "ExportLinearDocument");
  });

  it("fails rather than silently leaving an inaccessible Linear document resource external", async () => {
    const client = clientWithResources(new Error("Document is inaccessible"));
    await expect(syncLinearSnapshot({
      apiKey: "test-key",
      initiativeId: "initiative-1",
      client: client as unknown as LinearGraphQLClient,
      write: false,
    })).rejects.toThrow("Document is inaccessible");
  });
});
