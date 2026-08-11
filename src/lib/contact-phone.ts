import type { WhatsAppContact } from './types'

function digitsOnly(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

function isPlausiblePhone(digits: string) {
  return /^\d{8,15}$/.test(digits) && !/^0+$/.test(digits)
}

function normalizeBrazilianDisplayPhone(value: string | null | undefined) {
  const digits = digitsOnly(value)
  if (!digits) return ''

  let normalized =
    digits.length >= 12 && digits.startsWith('55')
      ? digits
      : digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')
        ? `55${digits}`
        : digits

  if (normalized.startsWith('55')) {
    const national = normalized.slice(2)
    if (national.length === 10) {
      const ddd = national.slice(0, 2)
      const subscriber = national.slice(2)
      if (/^[6-9]\d{7}$/.test(subscriber)) {
        normalized = `55${ddd}9${subscriber}`
      }
    }
  }

  return isPlausiblePhone(normalized) ? normalized : ''
}

export function contactPhoneDigits(contact: Pick<WhatsAppContact, 'phone_number' | 'remote_jid'>) {
  const explicit = normalizeBrazilianDisplayPhone(contact.phone_number)
  if (explicit) return explicit

  const jid = String(contact.remote_jid ?? '').trim()
  if (!jid.endsWith('@s.whatsapp.net')) return ''

  return normalizeBrazilianDisplayPhone(jid.split('@')[0])
}

export function formatPhoneNumber(value: string | null | undefined) {
  const digits = normalizeBrazilianDisplayPhone(value)
  if (!digits) return ''

  if (digits.startsWith('55')) {
    const national = digits.slice(2)
    if (national.length === 11) {
      return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`
    }
    if (national.length === 10) {
      return `+55 (${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`
    }
  }

  return `+${digits}`
}

export function formatContactPhone(contact: Pick<WhatsAppContact, 'phone_number' | 'remote_jid'>) {
  return formatPhoneNumber(contactPhoneDigits(contact))
}
