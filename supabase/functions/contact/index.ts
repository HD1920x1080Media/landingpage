// Supabase Edge Function: contact
//
// Nimmt das Kontaktformular der Impressum-Seite entgegen, archiviert die
// Nachricht in contact_messages und verschickt sie anschliessend per SMTP
// ueber GMX. Die Antwort-Adresse der Mail (replyTo) ist die im Formular
// angegebene Absender-Adresse — ein "Antworten" im Mailclient geht direkt
// an den Sender, nicht an das GMX-Postfach.
//
// Aufruf (vom Browser, ohne Supabase-Key):
//   POST /functions/v1/contact
//   Body: { name, email, message, website }   // website = Honeypot, muss leer sein
//
// Voraussetzung im GMX-Konto: unter Einstellungen → POP3/IMAP muss
// "POP3 und IMAP Zugriff erlauben" aktiviert sein, sonst lehnt GMX die
// SMTP-Anmeldung ab. MAIL_FROM muss die GMX-Adresse selbst oder ein dort
// eingerichteter Alias sein — fremde Absender weist GMX mit 553 zurueck.
//
// Deployment (der Browser sendet kein Supabase-JWT → verify_jwt aus):
//   supabase functions deploy contact --no-verify-jwt
//   supabase secrets set SMTP_USER=... SMTP_PASSWORD=... MAIL_FROM=... MAIL_TO=...

import { createClient } from 'jsr:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@^9'

// ── Konstanten ──────────────────────────────────────────────────────────────
// Erlaubte Origins: die Domain der Seite (public/CNAME) inkl. www-Variante.
const ALLOWED_ORIGINS = [
  'https://hd1920x1080.de',
  'https://www.hd1920x1080.de',
  // Android-App (Capacitor, androidScheme 'https')
  'https://localhost',
]

// GMX-Postausgangsserver. Port 465 = implizites TLS (SMTPS).
const SMTP_HOST = 'mail.gmx.net'
const SMTP_PORT = 465

const MAX_MESSAGE_LENGTH = 5000
const RATE_LIMIT_MAX = 3
const RATE_LIMIT_WINDOW_MINUTES = 10

// Bewusst simpel: keine RFC-5322-Vollpruefung, nur Plausibilitaet.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// ── Helfer ──────────────────────────────────────────────────────────────────

/** CORS-Header nur fuer bekannte Origins; unbekannte bekommen keinen Freibrief. */
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function jsonResponse(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

/** Erste IP aus x-forwarded-for; der Rest der Kette ist vom Client faelschbar. */
function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0].trim() || 'unknown'
}

/** Rohtext fuer die HTML-Mail entschaerfen. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ContactPayload {
  name?: unknown
  email?: unknown
  message?: unknown
  website?: unknown
}

// Transport auf Modulebene: die Instanz ueberlebt mehrere Aufrufe derselben
// Isolate, jede Mail baut aber eine eigene Verbindung auf (kein Pooling).
let transport: ReturnType<typeof nodemailer.createTransport> | null = null

function getTransport(user: string, password: string) {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  }
  return transport
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin)
  }

  const smtpUser = Deno.env.get('SMTP_USER')
  const smtpPassword = Deno.env.get('SMTP_PASSWORD')
  const mailFrom = Deno.env.get('MAIL_FROM')
  const mailTo = Deno.env.get('MAIL_TO')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!smtpUser || !smtpPassword || !mailFrom || !mailTo || !supabaseUrl || !serviceRoleKey) {
    console.error('contact: Secrets unvollstaendig')
    return jsonResponse({ error: 'Not configured' }, 500, origin)
  }

  const body = (await req.json().catch(() => null)) as ContactPayload | null
  if (!body) {
    return jsonResponse({ error: 'Invalid JSON' }, 400, origin)
  }

  // Honeypot: Bots fuellen das versteckte Feld. Wir antworten wie bei Erfolg,
  // damit der Bot keinen Hinweis auf die Erkennung bekommt — senden aber nichts.
  const honeypot = typeof body.website === 'string' ? body.website.trim() : ''
  if (honeypot) {
    return jsonResponse({ status: 'ok' }, 200, origin)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!name || !email || !message) {
    return jsonResponse({ error: 'Missing fields' }, 400, origin)
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    return jsonResponse({ error: 'Invalid email' }, 400, origin)
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse({ error: 'Message too long' }, 400, origin)
  }
  if (name.length > 200) {
    return jsonResponse({ error: 'Name too long' }, 400, origin)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Rate-Limit: max. RATE_LIMIT_MAX Requests je IP im Zeitfenster ──
  const ip = clientIp(req)
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString()

  const { count, error: rateReadError } = await supabase
    .from('contact_ratelimit')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', windowStart)

  if (rateReadError) {
    console.error('contact: Rate-Limit-Lesefehler', rateReadError)
    return jsonResponse({ error: 'Internal error' }, 500, origin)
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return jsonResponse({ error: 'Rate limit exceeded' }, 429, origin)
  }

  const { error: rateWriteError } = await supabase
    .from('contact_ratelimit')
    .insert({ ip })
  if (rateWriteError) {
    console.error('contact: Rate-Limit-Schreibfehler', rateWriteError)
    return jsonResponse({ error: 'Internal error' }, 500, origin)
  }

  // ── Archiv: erst speichern, dann senden. Faellt der Mailversand aus,
  //    ist die Nachricht trotzdem nicht verloren. ──
  const { data: inserted, error: insertError } = await supabase
    .from('contact_messages')
    .insert({ name, email, message, ip })
    .select('id')
    .single()

  if (insertError) {
    console.error('contact: Insert fehlgeschlagen', insertError)
    return jsonResponse({ error: 'Internal error' }, 500, origin)
  }

  // ── Mailversand via GMX-SMTP; replyTo = Absender aus dem Formular ──
  try {
    await getTransport(smtpUser, smtpPassword).sendMail({
      from: mailFrom,
      to: mailTo,
      replyTo: email,
      subject: `Kontaktformular: ${name}`,
      text: `Name: ${name}\nE-Mail: ${email}\n\n${message}`,
      html:
        `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
        `<p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>` +
        `<p><strong>Nachricht:</strong></p>` +
        `<p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>`,
    })
  } catch (err) {
    console.error('contact: SMTP-Versand fehlgeschlagen', err, 'message_id:', inserted?.id)
    return jsonResponse({ error: 'Mail delivery failed' }, 502, origin)
  }

  return jsonResponse({ status: 'ok' }, 200, origin)
})
