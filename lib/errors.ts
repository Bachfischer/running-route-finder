export class MapCapacityError extends Error {
  constructor() {
    super("Map area exceeded the processing budget.");
    this.name = "MapCapacityError";
  }
}
export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

// Distinguish connection failures from throttling, invalid data and query limits.
export class ProviderConnectionError extends ProviderError {
  constructor() {
    super("Could not connect to the map provider. Please try again shortly.");
    this.name = "ProviderConnectionError";
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor() {
    super("The map service timed out. Please try again.");
    this.name = "ProviderTimeoutError";
  }
}
