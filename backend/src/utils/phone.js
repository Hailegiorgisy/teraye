/**
 * Normalizes any Ethiopian mobile input (09..., 07..., +2519..., +2517..., 251..., 9..., 7...)
 * into both canonical representations so DB lookups match regardless of stored format.
 */
export function normalizeEthiopianPhone(rawPhone) {
  if (!rawPhone) return { e164: '', local: '', candidates: [] };

  // Strip spaces, dashes, and parentheses
  const cleaned = String(rawPhone).trim().replace(/[\s\-()]/g, '');

  let subscriber = ''; // 9 digits starting with 9 or 7

  if (cleaned.startsWith('+251') && cleaned.length === 13) {
    subscriber = cleaned.slice(4);
  } else if (cleaned.startsWith('251') && cleaned.length === 12) {
    subscriber = cleaned.slice(3);
  } else if ((cleaned.startsWith('09') || cleaned.startsWith('07')) && cleaned.length === 10) {
    subscriber = cleaned.slice(1);
  } else if ((cleaned.startsWith('9') || cleaned.startsWith('7')) && cleaned.length === 9) {
    subscriber = cleaned;
  } else {
    // Fallback for any non-standard input
    return { e164: cleaned, local: cleaned, candidates: [cleaned] };
  }

  const e164 = `+251${subscriber}`; // e.g. +251921319216
  const local = `0${subscriber}`;   // e.g. 0921319216

  return {
    e164,
    local,
    candidates: [e164, local],
  };
}