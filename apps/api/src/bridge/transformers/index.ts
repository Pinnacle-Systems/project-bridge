export type TransformerDirection = "oracleToApi" | "apiToOracle";

export type BridgeTransformer<TInput = unknown, TOutput = unknown> = {
  name: string;
  direction: TransformerDirection;
  transform(value: TInput): TOutput;
};

export type OracleBooleanMapping = {
  trueValue: string | number;
  falseValue: string | number;
};

export { transformReadValue, transformWriteValue, applyReadPermissionMask } from "./engine.js";
