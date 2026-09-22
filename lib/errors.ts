export class MapCapacityError extends Error {
  constructor() {
    super("Map area exceeded the processing budget.");
    this.name = "MapCapacityError";
  }
}
export class RouteError extends Error {
  code: "NO_START" | "NO_LOOP";
  constructor(code: "NO_START" | "NO_LOOP", message: string) {
    super(message);
    this.name = "RouteError";
    this.code = code;
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
