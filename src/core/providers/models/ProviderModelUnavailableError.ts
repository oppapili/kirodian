import { BRAND_NAME } from '../../../i18n/constants';

export class ProviderModelUnavailableError extends Error {
  constructor(providerName: string) {
    super(`The selected ${providerName} model is unavailable. Open ${BRAND_NAME} settings → ${providerName}, click Discover, and choose an enabled model.`);
    this.name = 'ProviderModelUnavailableError';
  }
}
