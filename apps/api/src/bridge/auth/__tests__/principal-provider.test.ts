import { describe, expect, it } from "vitest";
import { createStubPrincipalProvider, type AuthRequest } from "../index.js";

function makeRequest(headers: Record<string, string | undefined>): AuthRequest {
  return {
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  };
}

describe("StubPrincipalProvider", () => {
  const provider = createStubPrincipalProvider();

  it("returns null when x-bridge-user-id is missing", () => {
    const req = makeRequest({});
    expect(provider.resolvePrincipal(req)).toBeNull();
  });

  it("returns null when x-bridge-user-id is blank", () => {
    const req = makeRequest({ "x-bridge-user-id": "   " });
    expect(provider.resolvePrincipal(req)).toBeNull();
  });

  it("builds principal from user-id header", () => {
    const req = makeRequest({ "x-bridge-user-id": "ajaykk" });
    const principal = provider.resolvePrincipal(req);

    expect(principal).not.toBeNull();
    expect(principal!.userId).toBe("ajaykk");
    expect(principal!.roles).toEqual([]);
    expect(principal!.tenantIds).toEqual([]);
    expect(principal!.permissions).toEqual([]);
    expect(principal!.username).toBeUndefined();
  });

  it("parses comma-separated tenantIds", () => {
    const req = makeRequest({
      "x-bridge-user-id": "user-1",
      "x-bridge-tenant-id": "tenant_pssbsa, tenant_findb"
    });
    const principal = provider.resolvePrincipal(req);

    expect(principal!.tenantIds).toEqual(["tenant_pssbsa", "tenant_findb"]);
  });

  it("parses comma-separated roles", () => {
    const req = makeRequest({
      "x-bridge-user-id": "user-1",
      "x-bridge-roles": "bridge.admin,bridge.consumer"
    });
    const principal = provider.resolvePrincipal(req);

    expect(principal!.roles).toEqual(["bridge.admin", "bridge.consumer"]);
  });

  it("parses comma-separated permissions", () => {
    const req = makeRequest({
      "x-bridge-user-id": "user-1",
      "x-bridge-permissions": "currencies.read, employees.read"
    });
    const principal = provider.resolvePrincipal(req);

    expect(principal!.permissions).toEqual(["currencies.read", "employees.read"]);
  });

  it("captures optional username", () => {
    const req = makeRequest({
      "x-bridge-user-id": "user-1",
      "x-bridge-username": "Ajay K"
    });
    const principal = provider.resolvePrincipal(req);

    expect(principal!.username).toBe("Ajay K");
  });

  it("trims userId", () => {
    const req = makeRequest({ "x-bridge-user-id": "  ajaykk  " });
    const principal = provider.resolvePrincipal(req);

    expect(principal!.userId).toBe("ajaykk");
  });

  it("filters empty items from comma-separated lists", () => {
    const req = makeRequest({
      "x-bridge-user-id": "user-1",
      "x-bridge-roles": "bridge.admin,,,"
    });
    const principal = provider.resolvePrincipal(req);

    expect(principal!.roles).toEqual(["bridge.admin"]);
  });
});
