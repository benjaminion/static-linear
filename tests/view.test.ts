import { describe, expect, it } from "vitest";
import { serializeForScript } from "../src/lib/view";

describe("serializeForScript", () => {
  it("cannot terminate its containing script element", () => {
    const serialized = serializeForScript({ title: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized).title).toBe("</script><script>alert(1)</script>");
  });
});
