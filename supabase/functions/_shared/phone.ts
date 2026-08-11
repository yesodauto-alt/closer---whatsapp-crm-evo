// Single source of truth for WhatsApp/Brazilian phone identity.
// Keeps three concepts separate:
//   - remote_jid   = canonical phone-based WhatsApp JID when known
//   - lid_jid      = WhatsApp Linked ID (@lid), never displayed as a phone number
//   - phone_number = canonical digits only (no formatting, no @s.whatsapp.net)

export function onlyDigits(input: string): string {
  return (input ?? '').replace(/\D/g, '')
}

export function isLidJid(jid: string | null | undefined): boolean {
  return String(jid ?? '').trim().endsWith('@lid')
}

export function isPhoneJid(jid: string | null | undefined): boolean {
  const value = String(jid ?? '').trim()
  return /^\d+@s\.whatsapp\.net$/.test(value)
}

// Extract digits only from a phone-based direct WhatsApp JID.
export function digitsFromJid(jid: string): string {
  const jidStr = (jid ?? '').trim()
  if (!isPhoneJid(jidStr)) return ''
  return jidStr.split('@')[0]
}

// Normalize a Brazilian phone entry into canonical digits (no formatting).
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

export interface WhatsAppIdentity {
  remoteJid: string
  lidJid: string | null
  phoneNumber: string | null
}

// Resolve LID + alternate JID pairs emitted by newer WhatsApp/Baileys/Evolution versions.
// Example:
//   primaryJid   = 13391741591767@lid
//   alternateJid = 5511934136614@s.whatsapp.net
// Result:
//   remoteJid    = 5511934136614@s.whatsapp.net
//   lidJid       = 13391741591767@lid
//   phoneNumber  = 5511934136614
export function resolveWhatsAppIdentity(
  primaryJid: string | null | undefined,
  alternateJid?: string | null,
  rawNumber?: string | null,
): WhatsAppIdentity {
  const primary = String(primaryJid ?? '').trim()
  const alternate = String(alternateJid ?? '').trim()

  const phoneJid = [primary, alternate].find(isPhoneJid) || ''
  const lidJid = [primary, alternate].find(isLidJid) || null
  const numberFromJid = phoneJid ? digitsFromJid(phoneJid) : ''
  const numberFromField = normalizeBrazilianPhone(String(rawNumber ?? ''))
  const phoneNumber = numberFromJid || numberFromField || null

  const canonicalJid =
    phoneJid ||
    (phoneNumber ? `${phoneNumber}@s.whatsapp.net` : '') ||
    primary ||
    alternate

  return {
    remoteJid: canonicalJid,
    lidJid,
    phoneNumber,
  }
}

// Resolve the number to send to the Evolution API, never treating @lid digits as a phone.
export function resolveEvolutionNumber(
  remoteJid: string | null | undefined,
  phoneNumber: string | null | undefined,
): string {
  const fromJid = digitsFromJid(remoteJid ?? '')
  if (fromJid) return fromJid
  return normalizeBrazilianPhone(phoneNumber ?? '')
}
