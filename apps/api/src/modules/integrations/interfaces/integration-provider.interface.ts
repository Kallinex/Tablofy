import { IntegrationProviderType } from '@tablofy/shared/types';

export interface IntegrationConfig {
  tenantId: string;
  settings: Record<string, unknown>;
}

export interface IntegrationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export interface IntegrationProvider {
  readonly type: IntegrationProviderType;
  readonly name: string;

  initialize(config: IntegrationConfig): Promise<void>;
  validateConnection(): Promise<IntegrationResult<boolean>>;
  healthCheck(): Promise<IntegrationResult<{ status: string; latencyMs: number }>>;
}
