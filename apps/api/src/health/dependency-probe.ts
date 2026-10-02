/**
 * Shared outbound HTTP probe used by the external-dependency health indicators
 * (email, SMS, payment gateways).
 *
 * A probe is considered reachable when the remote host answers with any status
 * below 500: a 401/403/404/405 still proves the dependency is reachable, while
 * a 5xx, a connection error or a timeout means the dependency is not usable.
 */

export const DEFAULT_DEPENDENCY_TIMEOUT_MS = 5000;

export interface DependencyProbeResult {
  reachable: boolean;
  /** HTTP status code, or 0 when the request failed at the transport layer. */
  status: number;
  latencyMs: number;
  error?: string;
}

export function dependencyTimeoutMs(): number {
  const parsed = parseInt(process.env.HEALTH_DEPENDENCY_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEPENDENCY_TIMEOUT_MS;
}

export async function probeDependency(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = dependencyTimeoutMs(),
): Promise<DependencyProbeResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      reachable: response.status < 500,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      reachable: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
