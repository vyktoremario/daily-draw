/** Raised before touching the database when entries don't sum to zero. */
export class UnbalancedTransactionError extends Error {
  constructor(public readonly sumKobo: bigint) {
    super(`Ledger entries must sum to zero, got ${sumKobo} kobo`);
    this.name = 'UnbalancedTransactionError';
  }
}

/** Raised for structurally invalid input: too few entries, zero amounts, repeated accounts. */
export class InvalidLedgerEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLedgerEntryError';
  }
}

/** A player account would go below zero. Nothing was written. */
export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient funds');
    this.name = 'InsufficientFundsError';
  }
}

/** The idempotency key was already used for a different transaction. */
export class IdempotencyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was already used for a different transaction`);
    this.name = 'IdempotencyConflictError';
  }
}
