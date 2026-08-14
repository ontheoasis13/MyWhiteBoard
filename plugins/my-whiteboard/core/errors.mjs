export class WorkspaceError extends Error {
  constructor(message, code = "WORKSPACE_ERROR", details = {}) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }
}

export class ConflictError extends WorkspaceError {
  constructor(message, details = {}) {
    super(message, "VERSION_CONFLICT", details);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends WorkspaceError {
  constructor(message, details = {}) {
    super(message, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends WorkspaceError {
  constructor(message, details = {}) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}
