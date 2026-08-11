import type { WhatsAppContact } from './types'

function digitsOnly(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

function isPlausiblePhone(digits: string) {
  return /^\d{8,15}$/.test(digits) && !/^0+$/.test(digits)
}

export function contactPhoneDigits(contact: Pick<WhatsAppContact, 'phone_number' | 'remote_jid'>) {
  const explicit = digitsOnly(contact.phone_number)
  if (isPlausiblePhone(explicit)) return explicit

  const jid = String(contact.remote_jid ?? '').trim()
  if (!jid.endsWith('@s.whatsapp.net')) return ''

  const local = jid.split('@')[0]
  return isPlausiblePhone(local) ? local : ''
}

export function formatPhoneNumber(value: string | null | undefined) {
  const digits = digitsOnly(value)
  if (!isPlausiblePhone(digits)) return ''

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
