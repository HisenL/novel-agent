export class PermissionDeniedError extends Error {
  public constructor(capability: string) {
    super(`Exact capability '${capability}' has not been granted.`);
    this.name = "PermissionDeniedError";
  }
}

export class PermissionBroker {
  readonly #grants = new Set<string>();

  public grantExact(capability: string): void {
    assertExpandedGrantSet(CORE_CAPABILITY_REGISTRY, [capability]);
    this.#grants.add(capability);
  }

  public requireExact(capability: string): void {
    if (!this.#grants.has(capability))
      throw new PermissionDeniedError(capability);
  }
}

export interface BudgetReservation {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export class BudgetBroker {
  public reserve(reservation: BudgetReservation): BudgetReservation {
    if (reservation.maxInputTokens < 0 || reservation.maxOutputTokens < 0) {
      throw new Error("Token budgets cannot be negative.");
    }
    return reservation;
  }
}
import {
  assertExpandedGrantSet,
  CORE_CAPABILITY_REGISTRY,
} from "@novel-agent/protocol";
