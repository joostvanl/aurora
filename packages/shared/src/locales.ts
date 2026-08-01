/** BCP-47 language-REGION tags used by Aurora (e.g. en-US, nl-NL). */

export const LocaleCodeSchemaSource =
  /^[a-z]{2}-[A-Z]{2}$/ as unknown as RegExp;

export type LocaleInfo = {
  code: string;
  label: string;
  /** Flag emoji derived from the region subtag. */
  flag: string;
};

/** Common language-country pairs for the admin picker. */
export const LOCALE_CATALOG: LocaleInfo[] = [
  { code: "en-US", label: "English (United States)", flag: "🇺🇸" },
  { code: "en-GB", label: "English (United Kingdom)", flag: "🇬🇧" },
  { code: "nl-NL", label: "Nederlands (Nederland)", flag: "🇳🇱" },
  { code: "nl-BE", label: "Nederlands (België)", flag: "🇧🇪" },
  { code: "de-DE", label: "Deutsch (Deutschland)", flag: "🇩🇪" },
  { code: "de-AT", label: "Deutsch (Österreich)", flag: "🇦🇹" },
  { code: "fr-FR", label: "Français (France)", flag: "🇫🇷" },
  { code: "fr-BE", label: "Français (Belgique)", flag: "🇧🇪" },
  { code: "es-ES", label: "Español (España)", flag: "🇪🇸" },
  { code: "pt-PT", label: "Português (Portugal)", flag: "🇵🇹" },
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷" },
  { code: "it-IT", label: "Italiano (Italia)", flag: "🇮🇹" },
  { code: "sv-SE", label: "Svenska (Sverige)", flag: "🇸🇪" },
  { code: "da-DK", label: "Dansk (Danmark)", flag: "🇩🇰" },
  { code: "nb-NO", label: "Norsk bokmål (Norge)", flag: "🇳🇴" },
  { code: "fi-FI", label: "Suomi (Suomi)", flag: "🇫🇮" },
  { code: "pl-PL", label: "Polski (Polska)", flag: "🇵🇱" },
  { code: "cs-CZ", label: "Čeština (Česko)", flag: "🇨🇿" },
  { code: "ja-JP", label: "日本語 (日本)", flag: "🇯🇵" },
  { code: "zh-CN", label: "中文 (中国)", flag: "🇨🇳" },
  { code: "ko-KR", label: "한국어 (대한민국)", flag: "🇰🇷" },
];

const catalogByCode = new Map(LOCALE_CATALOG.map((l) => [l.code, l]));

/** Regional Indicator Symbol letters start at U+1F1E6 for 'A'. */
export function flagEmojiFromRegion(region: string): string {
  const code = region.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🏳️";
  const A = 0x1f1e6;
  const first = code.charCodeAt(0) - 65 + A;
  const second = code.charCodeAt(1) - 65 + A;
  return String.fromCodePoint(first, second);
}

export function isLocaleCode(value: string): boolean {
  return /^[a-z]{2}-[A-Z]{2}$/.test(value);
}

export function parseLocaleCode(code: string): {
  language: string;
  region: string;
} | null {
  if (!isLocaleCode(code)) return null;
  const [language, region] = code.split("-");
  return { language, region };
}

export function flagEmoji(code: string): string {
  const fromCatalog = catalogByCode.get(code);
  if (fromCatalog) return fromCatalog.flag;
  const parsed = parseLocaleCode(code);
  if (!parsed) return "🏳️";
  return flagEmojiFromRegion(parsed.region);
}

export function localeLabel(code: string): string {
  const fromCatalog = catalogByCode.get(code);
  if (fromCatalog) return fromCatalog.label;
  const parsed = parseLocaleCode(code);
  if (!parsed) return code;
  return `${parsed.language} (${parsed.region})`;
}

export function localeInfo(code: string): LocaleInfo {
  return {
    code,
    label: localeLabel(code),
    flag: flagEmoji(code),
  };
}

export function describeLocales(codes: string[]): LocaleInfo[] {
  return codes.map(localeInfo);
}

export const DEFAULT_LOCALE = "en-US";
