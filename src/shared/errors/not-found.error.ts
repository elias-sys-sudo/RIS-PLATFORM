import { RisError } from './ris.error';

/**
 * Thrown when a requested resource does not exist.
 * Returns 404 Not Found with entity type and ID.
 */
export class NotFoundError extends RisError {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super(`${entityType} not found`, 404, 'NOT_FOUND');
    this.entityType = entityType;
    this.entityId = entityId;
  }
}
