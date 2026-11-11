import type { PublicConfig } from '@/api/client'

// Synthetic fixtures only: no real people, codes or orders (AGENTS.md).

export const publicConfig: PublicConfig = {
  environment: 'local',
  features: {
    code_login: false,
    email_login: false,
    generation: false,
  },
}
