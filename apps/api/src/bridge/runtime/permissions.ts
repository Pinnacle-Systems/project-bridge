// Placeholder permission interface. Replace check() with real auth integration
// (e.g. JWT scope validation, role lookup) when an auth framework is available.

export type RequestIdentity = {
  userId?: string;
  roles?: string[];
  scopes?: string[];
};

export type PermissionChecker = {
  check(identity: RequestIdentity | undefined, permission: string): boolean;
};

export function createPermissiveChecker(): PermissionChecker {
  return {
    check() {
      return true;
    }
  };
}
