import { Injectable } from '@nestjs/common';
import { IntegrationProviderType } from '@tablofy/shared/types';
import { IntegrationProvider } from './interfaces/integration-provider.interface';

@Injectable()
export class IntegrationsService {
  private readonly providers = new Map<string, IntegrationProvider>();

  registerProvider(provider: IntegrationProvider): void {
    const key = `${provider.type}:${provider.name}`;
    this.providers.set(key, provider);
  }

  getProvider(type: IntegrationProviderType, name?: string): IntegrationProvider | undefined {
    if (name) {
      return this.providers.get(`${type}:${name}`);
    }
    return Array.from(this.providers.values()).find((p) => p.type === type);
  }

  getAllProviders(): IntegrationProvider[] {
    return Array.from(this.providers.values());
  }

  getProvidersByType(type: IntegrationProviderType): IntegrationProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.type === type);
  }

  removeProvider(type: IntegrationProviderType, name: string): boolean {
    return this.providers.delete(`${type}:${name}`);
  }
}
