import type { PublishedBridgeContract } from "../contracts/index.js";

export type RuntimeContractCache = {
  getByEndpoint(endpointPath: string): PublishedBridgeContract | undefined;
  listActive(): PublishedBridgeContract[];
};

export type RuntimeExecutionContext = {
  requestId: string;
  endpointPath: string;
};

export * from "./oracle-helpers.js";
