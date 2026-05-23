import { describe, expect, it, vi } from "vitest";
import { createDriftService } from "../service.js";
import type { DriftServiceStore, StoredDriftReport } from "../types.js";
import type { OracleSchemaSnapshot } from "../../oracleInspector/index.js";
import type { ResolvedApiContract } from "../../contracts/index.js";

const NOW = new Date("2026-05-07T00:00:00.000Z");

function contractWithoutSourceDatabase(): ResolvedApiContract {
  return {
    id: "published-1",
    resource: "employees",
    endpoint: "/api/hr/employees",
    version: 1,
    status: "active",
    publishedAt: NOW,
    source: { owner: "HR", type: "table", name: "EMPLOYEES" },
    fields: [{ apiField: "id", apiType: "integer", dbColumn: "EMPLOYEE_ID", oracleType: "number" }],
    operations: [{ operation: "list", enabled: true }],
    schemaHealth: { status: "healthy" },
    runtime: { apiConnectionId: "conn-1", cacheKey: "employees:v1", schemaVersion: "1" }
  };
}

function snapshot(): OracleSchemaSnapshot {
  return {
    connectionId: "conn-1",
    owner: "HR",
    inspectedAt: NOW.toISOString(),
    objects: [
      {
        owner: "HR",
        objectName: "EMPLOYEES",
        objectType: "TABLE",
        objectStatus: "VALID",
        columns: [
          {
            name: "EMPLOYEE_ID",
            oracleType: "NUMBER",
            nullable: false,
            dataLength: 22,
            precision: 10,
            scale: 0,
            charLength: null,
            dataDefault: null
          }
        ],
        constraints: [],
        indexes: []
      }
    ],
    sequences: [],
    programUnits: []
  };
}

describe("DriftService", () => {
  it("uses runtime apiConnectionId instead of source.database when loading snapshots", async () => {
    const getSnapshot = vi.fn().mockResolvedValue(snapshot());
    const report: StoredDriftReport = {
      id: "drift-1",
      publishedContractId: "published-1",
      severity: "healthy",
      status: "open",
      reportData: {
        contractId: "published-1",
        contractVersion: 1,
        oracleOwner: "HR",
        oracleObject: "EMPLOYEES",
        checkedAt: NOW,
        status: "healthy",
        findings: []
      },
      checkedAt: NOW,
      resolvedAt: null
    };
    const store: DriftServiceStore = {
      publishedContract: {
        findUnique: vi.fn().mockResolvedValue({ id: "published-1", contractData: contractWithoutSourceDatabase() }),
        findMany: vi.fn().mockResolvedValue([])
      },
      schemaDriftReport: {
        create: vi.fn().mockResolvedValue(report)
      }
    };

    await createDriftService({ store, getSnapshot }).runDriftCheck("published-1");

    expect(getSnapshot).toHaveBeenCalledWith("conn-1", "HR");
    expect(store.schemaDriftReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publishedContractId: "published-1",
        severity: "healthy",
        status: "open"
      })
    });
  });
});
