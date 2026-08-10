// Single source of truth for Brazilian phone normalization.
// Keeps two concepts separate:
//   - remote_jid   = original WhatsApp identifier (never modified)
//   - phone_number = canonical digits only (no formatting, no @s.whatsapp.net)

export function onlyDigits(input: string): string {
  return (input ?? '').replace(/\D/g, '')
}

// Extract digits from a direct WhatsApp JID: "5511999999999@s.whatsapp.net" -> "5511999999999".
// Returns "" when the JID is not a direct number (e.g. "@g.us", "@lid", "status@broadcast").
export function digitsFromJid(jid: string): string {
  const jidStr = (jid ?? '').trim()
  const before = jidStr.split('@')[0]
  if (!/^\d+$/.test(before)) return ''
  if (jidStr.includes('@') && !jidStr.endsWith('@s.whatsapp.net')) return ''
  return before
}

// Normalize a Brazilian phone entry into canonical digits (no formatting).
// Handles: "+55 11 99999-9999", "5511999999999", "11 99999-9999", "(11) 99999-9999", "11999999999".
// Rules:
//   - strip formatting, keep digits only
//   - recognize BR country code 55; never duplicate it
//   - never add or remove the 9th digit
export function normalizeBrazilianPhone(input: string): string {
  const digits = onlyDigits(input)
  if (!digits) return ''

  const brPrefixed = digits.length >= 12 && digits.startsWith('55')
  const looksNational = digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')

  if (brPrefixed) return digits
  if (looksNational) return '55' + digits
  return digits
}

// Resolve the number to send to the Evolution API, preferring the authoritative JID digits
// and falling back to the normalized phone_number.
export function resolveEvolutionNumber(
  remoteJid: string | null | undefined,
  phoneNumber: string | null | undefined,
): string {
  const fromJid = digitsFromJid(remoteJid ?? '')
  if (fromJid) return fromJid
  return normalizeBrazilianPhone(phoneNumber ?? '')
}