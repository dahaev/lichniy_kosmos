import type { PublicConfig } from '@/api/client'

// Synthetic fixtures only: no real people, codes or orders (AGENTS.md).

/**
 * The default, closed configuration: order creation is blocked until the
 * legal texts exist (Q12, SCR-05 К6, К14). `consent_version` is empty because
 * there is no approved consent text to version.
 */
export const publicConfig: PublicConfig = {
  environment: 'local',
  features: {
    code_login: false,
    email_login: false,
    generation: false,
  },
  consent_version: '',
  legal_ready: false,
}

/**
 * The consent version of the explicit test mode. It names no text: the real
 * wording is Q12 and is not invented here.
 */
export const TEST_CONSENT_VERSION = 'test-consent-v0'

/**
 * The configuration of the explicit test mode of order creation (SCR-05 К8):
 * the owner can try the screen on mocks. It is served only by the dev build
 * with MSW and `?creation=test`; see `handlers.ts`.
 */
export function testCreationConfig(consentVersion: string = TEST_CONSENT_VERSION): PublicConfig {
  return {
    environment: 'local',
    features: { code_login: true, email_login: false, generation: true },
    consent_version: consentVersion,
    legal_ready: true,
  }
}
