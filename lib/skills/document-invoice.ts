/**
 * Semantic premium invoice renderer.
 *
 * The generic premium path renders Markdown as a styled article. For invoices
 * that is not enough: a real invoice must be a *composed document* — header,
 * customer card, professional line-item table, visually-hierarchical totals,
 * payment/bank block and footer — not a linear transcription of the source
 * Markdown (with its 👤 / 📋 / 📝 emoji section markers).
 *
 * This module turns whatever the model sent (structured spec fields OR a
 * Markdown body) into a structured {@link InvoiceModel}, then renders that
 * model into a dedicated, print-safe HTML/CSS invoice. The Playwright pipeline
 * (document-pdf-html.ts) simply prints the resulting HTML to PDF.
 *
 * Emoji section markers are parsed into semantic roles and then discarded — the
 * template decides typography, spacing, borders, badges and cards.
 */

import { buildMarkdownSource } from './document-runtime'

export interface InvoiceItem {
  description: string
  qty?: string
  unitPrice?: string
  total?: string
}

export interface InvoiceModel {
  brand?: string
  tagline?: string
  seller: string[]
  title?: string
  invoiceNumber?: string
  issueDate?: string
  dueDate?: string
  currency: string
  customer: string[]
  items: InvoiceItem[]
  subtotal?: string
  taxLabel?: string
  tax?: string
  total?: string
  paymentTerms: string[]
  bank: string[]
  footer?: string
}

// Strip emoji / dingbat ranges so they never leak into the composed PDF.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2700}-\u{27BF}]/gu
function stripEmoji(s: string): string {
  return s
    .replace(EMOJI_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const AMOUNT_RE = /[\d\s]*[.,]\d{2}\s*€?|€\s*[\d\s,.]+/g

/** Parse a French/EU amount string ("2 500,00 €", "1 250.00") into a number. */
function parseAmount(raw: string): number | null {
  if (!raw) return null
  const m = raw.match(AMOUNT_RE)
  if (!m) return null
  const cleaned = m[0]
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // thousands dot
    .replace(/,/g, '.') // decimal comma
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Format a number as a French euro amount: "2 500,00 €". */
function formatEUR(n: number): string {
  const fixed = n.toFixed(2)
  const [int, dec] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${grouped},${dec} €`
}

const DATE_RE =
  /(\d{1,2})\s+([a-zàâäéèêëîïôöùûüç]+)\.?\s+(\d{4})|(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/i

/** Build a structured invoice model from a document spec. */
export function buildInvoiceModel(spec: Record<string, unknown>): InvoiceModel {
  const model: InvoiceModel = {
    currency: '€',
    customer: [],
    seller: [],
    items: [],
    paymentTerms: [],
    bank: []
  }

  // 1) Prefer explicit structured fields when the model provides them.
  const structured = spec.invoice as Record<string, unknown> | undefined
  const src = (structured ?? spec) as Record<string, unknown>

  const take = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = src[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return undefined
  }

  model.brand = take('brand', 'company', 'issuer', 'from')
  model.tagline = take('tagline', 'slogan')
  model.title = take('docTitle', 'documentTitle') ?? 'FACTURE'
  model.invoiceNumber = take('invoiceNumber', 'number', 'invoiceNo', 'ref')
  model.issueDate = take('issueDate', 'date', 'created')
  model.dueDate = take('dueDate', 'due')
  if (typeof src.currency === 'string' && src.currency.trim())
    model.currency = src.currency.trim()

  // 2) Otherwise parse the Markdown body (the common path).
  const md = buildMarkdownSource(spec)
  const lines = md.split(/\r?\n/)
  const text = md.toLowerCase()

  // --- Title / brand from the first heading -------------------------------
  const heading = /^\s*#\s+(.*)$/m.exec(md)
  if (heading) {
    const h = stripEmoji(heading[1])
    // "Facture N° FAC-2024-001" → title "Facture", number "FAC-2024-001"
    const numMatch = h.match(/n[°o]?\s*[:#]?\s*([A-Za-z0-9\-/_]+)/i)
    if (numMatch && !model.invoiceNumber) model.invoiceNumber = numMatch[1]
    if (!model.title || model.title === 'FACTURE') {
      model.title =
        h.replace(/n[°o]?\s*[:#]?\s*[A-Za-z0-9\-/_]+/i, '').trim() || 'FACTURE'
    }
  }

  // --- Brand line: "OPTIX AI — AI SOLUTIONS" -----------------------------
  if (!model.brand) {
    for (const l of lines) {
      const s = stripEmoji(l).trim()
      if (!s) continue
      if (
        /—|–|-/.test(s) &&
        /[a-z]{2,}/i.test(s) &&
        !/factur|invoice|condition|paiement|échéance/i.test(s)
      ) {
        const [name, ...rest] = s.split(/—|–|-/)
        model.brand = name.trim()
        if (!model.tagline && rest.length) model.tagline = rest.join(' ').trim()
        break
      }
    }
  }

  // --- Section splitting by emoji or keyword markers --------------------
  const sectionBoundaries = (i: number): boolean => {
    const s = stripEmoji(lines[i]).trim().toLowerCase()
    return (
      /^[👤📋📝]/u.test(lines[i]) ||
      /factur[ée]\s*[àa]|client|bill\s*to|👤/i.test(s) ||
      /d[ée]tails|ligne|article|description|📋/i.test(s) ||
      /condition|paiement|payment|📝/i.test(s)
    )
  }

  // Customer block: lines after a customer marker until the next marker.
  let customerStarted = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const s = stripEmoji(raw).trim()
    const low = s.toLowerCase()
    const isCustomerMarker =
      /^[👤]/u.test(raw) || /^(factur[ée]\s*[àa]|client|bill\s*to)\b/i.test(low)
    const isItemsMarker =
      /^[📋]/u.test(raw) ||
      /^(d[ée]tails|ligne|article|description)\b/i.test(low)
    const isTermsMarker =
      /^[📝]/u.test(raw) || /^(condition|paiement|payment)\b/i.test(low)

    if (isCustomerMarker) {
      customerStarted = true
      continue
    }
    if (isItemsMarker || isTermsMarker) {
      customerStarted = false
      continue
    }
    if (customerStarted && s && !/^\s*#/.test(raw)) {
      model.customer.push(s)
    }
  }
  model.customer = model.customer.map(stripEmoji).filter(Boolean)

  // --- Seller / issuer block ----------------------------------------------
  let sellerStarted = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const s = stripEmoji(raw).trim()
    const low = s.toLowerCase()
    const isSellerMarker =
      /^(émetteur|emetteur|société|societe|seller|from|issuer|company)\b/i.test(
        low
      )
    const isOtherMarker =
      /^[👤📋📝]/u.test(raw) ||
      /^(factur|client|d[ée]tail|ligne|article|description|condition|paiement|payment)\b/i.test(
        low
      )
    if (isSellerMarker) {
      sellerStarted = true
      continue
    }
    if (isOtherMarker) {
      sellerStarted = false
      continue
    }
    if (sellerStarted && s && !/^\s*#/.test(raw)) {
      model.seller.push(s)
    }
  }
  model.seller = model.seller.map(stripEmoji).filter(Boolean)

  // --- Line items: first Markdown table after the items marker ----------
  const tableIdx = lines.findIndex((l, i) => {
    const low = stripEmoji(l).toLowerCase()
    const isItemsMarker =
      /^[📋]/u.test(l) || /^(d[ée]tails|ligne|article|description)\b/i.test(low)
    // table starts within a couple lines after the marker
    if (!isItemsMarker) return false
    let j = i + 1
    while (j < lines.length && j < i + 4 && !/^\s*\|/.test(lines[j])) j++
    return j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])
  })
  if (tableIdx >= 0) {
    let j = tableIdx + 1
    while (j < lines.length && !/^\s*\|.*\|\s*$/.test(lines[j])) j++
    if (j < lines.length) {
      const header = splitRow(lines[j]).map(h => h.toLowerCase())
      const sep = j + 1
      if (sep < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[sep])) {
        const colOf = (...keys: string[]) =>
          header.findIndex(h => keys.some(k => h.includes(k)))
        const iDesc = colOf(
          'description',
          'libellé',
          'article',
          'prestation',
          'désignation'
        )
        const iQty = colOf('qté', 'quant', 'qty', 'units')
        const iPrice = colOf('pu', 'prix', 'unit', 'ht')
        const iTotal = colOf('total', 'montant', 'ttc', 'tht')
        let k = sep + 1
        while (k < lines.length && /^\s*\|.*\|\s*$/.test(lines[k])) {
          const cells = splitRow(lines[k])
          model.items.push({
            description: cells[iDesc] ?? cells[0] ?? '',
            qty: iQty >= 0 ? cells[iQty] : undefined,
            unitPrice: iPrice >= 0 ? cells[iPrice] : undefined,
            total: iTotal >= 0 ? cells[iTotal] : undefined
          })
          k++
        }
      }
    }
  }
  model.items = model.items
    .map(it => ({
      description: stripEmoji(it.description ?? '').trim(),
      qty: it.qty ? stripEmoji(it.qty).trim() : undefined,
      unitPrice: it.unitPrice ? stripEmoji(it.unitPrice).trim() : undefined,
      total: it.total ? stripEmoji(it.total).trim() : undefined
    }))
    .filter(it => it.description)

  // --- Totals: scan lines for subtotal / tax / grand total --------------
  let computedSubtotal: number | null = null
  if (model.items.length) {
    const sums = model.items
      .map(it => parseAmount(it.total ?? ''))
      .filter((n): n is number => n !== null)
    if (sums.length === model.items.length) {
      computedSubtotal = sums.reduce((a, b) => a + b, 0)
    }
  }
  for (const raw of lines) {
    const s = stripEmoji(raw)
    const low = s.toLowerCase()
    const amt = parseAmount(s)
    if (/sous[- ]?total|total\s*ht|subtotal/i.test(low)) {
      if (amt != null) model.subtotal = formatEUR(amt)
    } else if (/tva|vat|tax/i.test(low)) {
      const rate = /(\d{1,2})\s*%/.exec(s)
      if (rate) model.taxLabel = `TVA ${rate[1]} %`
      if (amt != null) model.tax = formatEUR(amt)
      else if (rate && computedSubtotal != null) {
        model.tax = formatEUR(computedSubtotal * (parseInt(rate[1], 10) / 100))
      }
    } else if (
      /total\s*ttc|grand\s*total|total\s*à\s*payer|net\s*à\s*payer/i.test(low)
    ) {
      if (amt != null) model.total = formatEUR(amt)
    }
  }
  // Fallbacks from computed values.
  if (computedSubtotal != null && !model.subtotal)
    model.subtotal = formatEUR(computedSubtotal)
  if (
    model.subtotal &&
    model.taxLabel &&
    !model.tax &&
    computedSubtotal != null
  ) {
    const rate = /(\d{1,2})/.exec(model.taxLabel)
    if (rate)
      model.tax = formatEUR(computedSubtotal * (parseInt(rate[1], 10) / 100))
  }
  if (model.subtotal && model.tax && !model.total) {
    const a = parseAmount(model.subtotal)
    const b = parseAmount(model.tax)
    if (a != null && b != null) model.total = formatEUR(a + b)
  }

  // --- Dates from keyword-adjacent matches ------------------------------
  const dateCandidates: { date: string; kind: 'issue' | 'due' | 'other' }[] = []
  for (const raw of lines) {
    const low = raw.toLowerCase()
    const m = DATE_RE.exec(raw)
    if (m) {
      const date = m[0].trim()
      if (/émis|émet|date|créé|created|issued/.test(low))
        dateCandidates.push({ date, kind: 'issue' })
      else if (/échéance|due|paiement\s*avant/.test(low))
        dateCandidates.push({ date, kind: 'due' })
      else dateCandidates.push({ date, kind: 'other' })
    }
  }
  if (!model.issueDate) {
    const i = dateCandidates.find(d => d.kind === 'issue')
    model.issueDate =
      i?.date ?? dateCandidates.find(d => d.kind === 'other')?.date
  }
  if (!model.dueDate) {
    const d = dateCandidates.find(c => c.kind === 'due')
    model.dueDate = d?.date
  }

  // --- Payment terms + bank info ---------------------------------------
  let inTerms = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const s = stripEmoji(raw).trim()
    const low = s.toLowerCase()
    const isTermsMarker = /^[📝]/u.test(raw) || /^conditions?\b/i.test(low)
    const isOtherMarker =
      /^[👤📋]/u.test(raw) ||
      /^(factur|client|d[ée]tail|ligne|article|description)\b/i.test(low)
    if (isTermsMarker) {
      inTerms = true
      continue
    }
    if (isOtherMarker) {
      inTerms = false
      continue
    }
    if (inTerms && s && !/^\s*#/.test(raw)) {
      if (/merci|thank\s*you|au plaisir/i.test(low)) {
        model.footer = s
        inTerms = false
        continue
      }
      if (/iban|bic|swift|virement|compte|bancaire/i.test(low))
        model.bank.push(s)
      else model.paymentTerms.push(s)
    }
  }
  model.paymentTerms = model.paymentTerms.map(stripEmoji).filter(Boolean)
  model.bank = model.bank.map(stripEmoji).filter(Boolean)

  // --- Footer: a "merci" / thank-you line near the end -----------------
  const thanks = lines.find(l => /merci|thank\s*you|au plaisir/i.test(l))
  if (thanks) model.footer = stripEmoji(thanks).trim()

  return model
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim())
}

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function rowHtml(it: InvoiceItem): string {
  const num = (v?: string) =>
    v ? `<td class="num">${esc(v)}</td>` : '<td class="num">—</td>'
  return `<tr>
    <td>${esc(it.description)}</td>
    ${num(it.qty)}
    ${num(it.unitPrice)}
    ${num(it.total)}
  </tr>`
}

/**
 * Composed, print-safe invoice template.
 *
 * Each sub-renderer below is a self-contained presentational component with its
 * own markup + the shared CSS contract (`.invoice-header`, `.party-card`,
 * `.invoice-section`, `.invoice-table`, `.invoice-summary`, `.payment-card`,
 * `.invoice-footer`). The page is composed from semantic model data, not from a
 * linear transcription of the source Markdown. `break-inside: avoid` on every
 * logical block keeps an A4 invoice on a single, elegant page.
 */

/** Brand / logo lockup + document title, number and key dates. */
function InvoiceHeader(model: InvoiceModel): string {
  const brand = esc(model.brand ?? 'Votre entreprise')
  const tagline = model.tagline
    ? `<div class="tagline">${esc(model.tagline)}</div>`
    : ''
  const title = esc(model.title ?? 'FACTURE')
  const number = model.invoiceNumber ? esc(model.invoiceNumber) : '—'
  const dates: string[] = []
  if (model.issueDate) dates.push(`Émise le ${esc(model.issueDate)}`)
  if (model.dueDate) dates.push(`Échéance ${esc(model.dueDate)}`)
  const dateHtml = dates.map(d => `<div class="doc-date">${d}</div>`).join('')
  return `<header class="invoice-header invoice-section">
    <div class="brand-block">
      <div class="brand">${brand}</div>
      ${tagline}
    </div>
    <div class="title-block">
      <div class="doc-title">${title}</div>
      <div class="doc-number">N° ${number}</div>
      ${dateHtml}
    </div>
  </header>`
}

/** Issuer / seller card ("Émetteur"). Falls back to the brand lockup. */
function SellerCard(model: InvoiceModel): string {
  const lines = model.seller.length
    ? model.seller
    : [
        model.brand ?? 'Votre entreprise',
        ...(model.tagline ? [model.tagline] : [])
      ]
  const body = lines
    .map(l => `<div class="party-line">${esc(l)}</div>`)
    .join('')
  return `<div class="party-card invoice-section">
    <div class="party-label">Émetteur</div>
    ${body}
  </div>`
}

/** Customer card ("Facturé à"). */
function CustomerCard(model: InvoiceModel): string {
  if (!model.customer.length) return ''
  const body = model.customer
    .map(l => `<div class="party-line">${esc(l)}</div>`)
    .join('')
  return `<div class="party-card invoice-section">
    <div class="party-label">Facturé à</div>
    ${body}
  </div>`
}

/** Line-item table ("Prestations"). */
function LineItemsTable(model: InvoiceModel): string {
  if (!model.items.length) return ''
  const rows = model.items.map(rowHtml).join('')
  return `<section class="invoice-section">
    <div class="section-title">Prestations</div>
    <table class="invoice-table">
      <thead><tr><th>Description</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`
}

/** Right-aligned totals panel with a highlighted grand total. */
function TotalsPanel(model: InvoiceModel): string {
  const rows: string[] = []
  if (model.subtotal)
    rows.push(
      `<div class="tot-row"><span>Sous-total HT</span><span class="num">${esc(model.subtotal)}</span></div>`
    )
  if (model.tax || model.taxLabel)
    rows.push(
      `<div class="tot-row"><span>${esc(model.taxLabel ?? 'TVA')}</span><span class="num">${esc(model.tax ?? '—')}</span></div>`
    )
  if (model.total)
    rows.push(
      `<div class="tot-row tot-grand"><span>Total TTC</span><span class="num">${esc(model.total)}</span></div>`
    )
  if (!rows.length) return ''
  return `<div class="invoice-summary">
    <div class="totals">${rows.join('')}</div>
  </div>`
}

/** Payment terms / conditions. */
function Notes(model: InvoiceModel): string {
  if (!model.paymentTerms.length) return ''
  const body = model.paymentTerms
    .map(t => `<div class="note-line">${esc(t)}</div>`)
    .join('')
  return `<section class="invoice-section">
    <div class="section-title">Conditions de paiement</div>
    ${body}
  </section>`
}

/** Bank / payment details card. */
function PaymentCard(model: InvoiceModel): string {
  if (!model.bank.length) return ''
  const body = model.bank
    .map(b => `<div class="bank-line">${esc(b)}</div>`)
    .join('')
  return `<div class="payment-card invoice-section">
    <div class="payment-title">Coordonnées bancaires</div>
    ${body}
  </div>`
}

/** Closing thank-you line. */
function InvoiceFooter(model: InvoiceModel): string {
  const brand = esc(model.brand ?? 'Votre entreprise')
  const text = model.footer ? esc(model.footer) : 'Merci de votre confiance'
  return `<footer class="invoice-footer">${text}<div class="footer-brand">${brand}</div></footer>`
}

/** Render a structured invoice model into a complete, print-safe HTML doc. */
export function renderInvoiceHtml(
  model: InvoiceModel,
  accent = '#2563eb'
): string {
  const title = esc(model.title ?? 'FACTURE')
  const number = model.invoiceNumber ? esc(model.invoiceNumber) : '—'

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${title} ${number}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #1a1a1e;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px; line-height: 1.5;
    background: #fff;
  }
  .invoice { max-width: 760px; margin: 0 auto; padding: 36px 40px 28px; }

  /* Pagination control: keep every logical block on one page. */
  .invoice-section, .party-card, .invoice-summary, .payment-card { break-inside: avoid; }
  .invoice-table { break-inside: auto; }

  .invoice-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 16px; border-bottom: 3px solid var(--accent); }
  .brand-block { min-width: 0; }
  .brand { font-size: 23px; font-weight: 800; letter-spacing: 0.3px; color: #0b0b0f; line-height: 1.1; }
  .tagline { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-top: 4px; font-weight: 700; }
  .title-block { text-align: right; }
  .doc-title { font-size: 30px; font-weight: 800; color: var(--accent); line-height: 1; letter-spacing: 0.5px; }
  .doc-number { font-size: 12.5px; color: #55555c; margin-top: 6px; font-weight: 600; }
  .doc-date { font-size: 11.5px; color: #6a6a72; margin-top: 2px; }

  .invoice-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
  .party-card { border: 1px solid #e7e7ee; border-radius: 10px; padding: 12px 14px; background: #fbfbfd; }
  .party-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1.3px; color: var(--accent); font-weight: 700; margin-bottom: 7px; }
  .party-line { font-size: 12.5px; color: #2a2a30; }

  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--accent); font-weight: 700; margin: 22px 0 10px; }
  .invoice-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .invoice-table thead th { background: var(--accent); color: #fff; text-align: left; padding: 9px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; }
  .invoice-table thead th.num, .invoice-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .invoice-table tbody td { padding: 9px 12px; border-bottom: 1px solid #eee; }
  .invoice-table tbody tr:last-child td { border-bottom: 1px solid #dcdce4; }

  .invoice-summary { display: flex; justify-content: flex-end; margin-top: 16px; }
  .totals { width: 300px; }
  .tot-row { display: flex; justify-content: space-between; padding: 6px 4px; font-size: 12.5px; color: #2a2a30; }
  .tot-row .num { font-variant-numeric: tabular-nums; font-weight: 600; }
  .tot-grand { margin-top: 6px; background: var(--accent); color: #fff; border-radius: 8px; padding: 11px 14px; font-size: 15px; font-weight: 800; }
  .tot-grand .num { font-weight: 800; }

  .note-line { font-size: 12.5px; color: #2a2a30; margin: 2px 0; }

  .payment-card { margin-top: 18px; border: 1px solid #e7e7ee; border-left: 4px solid var(--accent); border-radius: 10px; padding: 12px 16px; background: #fbfbfd; }
  .payment-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1.3px; color: var(--accent); font-weight: 700; margin-bottom: 7px; }
  .bank-line { font-size: 12.5px; color: #2a2a30; margin: 2px 0; }

  .invoice-footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #eee; text-align: center; font-size: 11.5px; color: #6a6a72; }
  .footer-brand { font-weight: 700; color: #1a1a1e; margin-top: 4px; }
</style>
</head>
<body>
  <div class="invoice">
    ${InvoiceHeader(model)}
    <div class="invoice-parties">
      ${SellerCard(model)}
      ${CustomerCard(model)}
    </div>
    ${LineItemsTable(model)}
    ${TotalsPanel(model)}
    ${Notes(model)}
    ${PaymentCard(model)}
    ${InvoiceFooter(model)}
  </div>
</body>
</html>`
}
