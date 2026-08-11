// Single source of truth for WhatsApp/Brazilian phone identity.
// Keeps three concepts separate:
//   - remote_jid   = canonical phone-based WhatsApp JID when known
//   - lid_jid      = WhatsApp Linked ID (@lid), never displayed as a phone number
//   - phone_number = canonical digits only (no formatting, no @s.whatsapp.net)

export function onlyDigits(input: string): string {
  return (input ?? '').replace(/\D/g, '')
}

export function isPlausiblePhoneDigits(digits: string): boolean {
  return /^\d{8,15}$/.test(digits) && !/^0+$/.test(digits)
}

export function isLidJid(jid: string | null | undefined): boolean {
  return String(jid ?? '').trim().endsWith('@lid')
}

export function isPhoneJid(jid: string | null | undefined): boolean {
  const value = String(jid ?? '').trim()
  if (!value.endsWith('@s.whatsapp.net')) return false
  return isPlausiblePhoneDigits(value.split('@')[0])
}

// Extract digits only from a phone-based direct WhatsApp JID.
export function digitsFromJid(jid: string): string {
  const jidStr = (jid ?? '').trim()
  if (!isPhoneJid(jidStr)) return ''
  return jidStr.split('@')[0]
}

// Normalize a phone entry into canonical digits (no formatting).
// Brazilian national numbers receive country code 55; impossible placeholders are rejected.
export function normalizeBrazilianPhone(input: string): string {
  const digits = onlyDigits(input)
  if (!digits) return ''

  const normalized =
    digits.length >= 12 && digits.startsWith('55')
      ? digits
      : digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')
        ? '55' + digits
        : digits

  return isPlausiblePhoneDigits(normalized) ? normalized : ''
}

export interface WhatsAppIdentity {
  remoteJid: string
  lidJid: string | null
  phoneNumber: string | null
}

// Resolve LID + alternate JID pairs emitted by newer WhatsApp/Baileys/Evolution versions.
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

// Resolve the number to send to the Evolution API, never treating @lid or placeholders as a phone.
export function resolveEvolutionNumber(
  remoteJid: string | null | undefined,
  phoneNumber: string | null | undefined,
): string {
  const fromJid = digitsFromJid(remoteJid ?? '')
  if (fromJid) return fromJid
  return normalizeBrazilianPhone(phoneNumber ?? '')
}
