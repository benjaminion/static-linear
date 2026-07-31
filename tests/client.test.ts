import { describe, expect, it, vi } from "vitest";
import { LinearGraphQLClient } from "../src/lib/linear/client";

describe("LinearGraphQLClient", () => {
  it("rejects partial GraphQL responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { viewer: { id: "me" } },
      errors: [{ message: "Field unavailable", path: ["viewer", "name"] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new LinearGraphQLClient("secret-key", "https://example.test/graphql", fetchMock);
    await expect(client.request("query { viewer { id } }")).rejects.toThrow("Field unavailable at viewer.name");
  });

  it("does not put the API key in request bodies or errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "Denied" }] }), { status: 401 }));
    const client = new LinearGraphQLClient("top-secret", "https://example.test/graphql", fetchMock);
    await expect(client.request("query Test { viewer { id } }")).rejects.not.toThrow("top-secret");
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("top-secret");
    expect(init.body).not.toContain("top-secret");
  });
});

