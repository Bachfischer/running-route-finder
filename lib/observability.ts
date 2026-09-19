import { randomUUID } from "node:crypto";
import { failure } from "./http.ts";

type Event = {
  requestId: string;
  operation: string;
  status: number;
  durationMs: number;
};
// Deliberately omit URLs, coordinates, addresses, IPs and provider/error payloads.
export function observed(
  operation: string,
  handler: (request: Request) => Promise<Response>,
  log: (event: Event) => void = console.info,
  now: () => number = Date.now,
) {
  return async (request: Request) => {
    const requestId = randomUUID(),
      started = now();
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      response = failure(error);
    }
    response.headers.set("X-Request-ID", requestId);
    try {
      log({
        requestId,
        operation,
        status: response.status,
        durationMs: Math.max(0, now() - started),
      });
    } catch {
      /* Telemetry must not make a successful route fail. */
    }
    return response;
  };
}
