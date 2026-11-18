export type PhoneFormatMode = 'local' | 'international';

/**
 * Strips formatting spaces/dashes and validates Ethiopian mobile numbers:
 * - local: 10 digits starting with 09 or 07 (e.g. 0921319216, 0712345678)
 * - international: 13 chars starting with +2519 or +2517 (e.g. +251921319216)
 */
export function sanitizePhoneInput(raw: string, mode: PhoneFormatMode): string {
  const cleaned = raw.replace(/[^\d+]/g, '');

  if (mode === 'international') {
    // Ensure it starts with +251 if user types digits
    if (!cleaned.startsWith('+')) {
      const digitsOnly = cleaned.replace(/\+/g, '');
      if (digitsOnly.startsWith('251')) return '+' + digitsOnly.slice(0, 12);
      if (digitsOnly.startsWith('0')) return '+251' + digitsOnly.slice(1, 10);
      return '+251' + digitsOnly.slice(0, 9);
    }
    return '+' + cleaned.slice(1).replace(/\+/g, '').slice(0, 12);
  }

  // Local mode: 09... or 07... (10 digits max)
  const digitsOnly = cleaned.replace(/\+/g, '');
  if (digitsOnly.startsWith('251') && digitsOnly.length > 3) {
    return ('0' + digitsOnly.slice(3)).slice(0, 10);
  }
  return digitsOnly.slice(0, 10);
}

export function isValidEthiopianPhone(phone: string): boolean {
  const trimmed = phone.trim();
  const isLocal = /^0[97]\d{8}$/.test(trimmed);
  const isIntl = /^\+251[97]\d{8}$/.test(trimmed);
  return isLocal || isIntl;
}
