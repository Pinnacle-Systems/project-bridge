import { describe, expect, it } from "vitest";

import {
  bridgeModuleName,
  type BridgeContractDraft,
  type OracleObjectSummary
} from "../index.js";

describe("Bridge module", () => {
  it("can be imported from the module barrel", () => {
    const source: OracleObjectSummary = {
      owner: "LEGACY_OWNER",
      name: "EMPLOYEE_MASTER",
      type: "TABLE",
      status: "VALID"
    };

    const draft: BridgeContractDraft = {
      resource: "employees",
      endpoint: "/api/hr/employees",
      source: {
        database: "legacy_oracle",
        owner: source.owner,
        type: "table",
        name: source.name
      },
      fields: [
        {
          apiField: "id",
          apiType: "integer",
          dbColumn: "EMPLOYEE_ID",
          oracleType: "number",
          required: true
        }
      ],
      operations: [
        {
          operation: "list",
          enabled: true
        },
        {
          operation: "read",
          enabled: true
        }
      ]
    };

    expect(bridgeModuleName).toBe("Bridge");
    expect(draft.source.name).toBe("EMPLOYEE_MASTER");
  });
});
