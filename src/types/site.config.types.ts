// src/types/site.config.types.ts
export interface SiteConfig {
  siteName: string;
  baseURL: string;
  botToken: string;
  h25User: string;
  h25Password: string;
  t6User: string;
  t6Password: string;
  sessionsDirectory: string;
  sessionFileName: string;
  bonusT6: string;
  bonusH25: string;
  chatT6: string;
  chatH25: string;
  siteCode: string;
  siteId: string;
  platformType: number | string;
}
