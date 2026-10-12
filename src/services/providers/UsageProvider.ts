import { AccountCredentials, ProviderType, UsageSnapshot } from '../../models/types';

export interface ProviderFetchResult {
  snapshot: UsageSnapshot;
  updatedCredentials?: AccountCredentials;
}

export interface UsageProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly name: string;

  validateCredentials(credentials: AccountCredentials): boolean;
  fetchUsage(accountId: string, credentials: AccountCredentials): Promise<ProviderFetchResult>;
}
