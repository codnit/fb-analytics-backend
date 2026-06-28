import type { PartnerEntity } from "../types/domain";

const REQUIRED_ONBOARDING_FIELDS = [
  "name",
  "email",
  "phone",
  "country",
  "company",
  "publisher_type",
  "niche_category",
  "reason_joining",
] as const;

export const isPartnerOnboardingComplete = (partner?: Partial<PartnerEntity> | null): boolean =>
  REQUIRED_ONBOARDING_FIELDS.every((field) => {
    const value = partner?.[field];

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    return Boolean(value);
  });

