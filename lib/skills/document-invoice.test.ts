import { describe, expect, it } from 'vitest'

import { buildInvoiceModel, renderInvoiceHtml } from './document-invoice'

const SAMPLE = `# Facture N° FAC-2024-001

OPTIX AI — AI SOLUTIONS

Émise le : 25 août 2026
Échéance : 10 septembre 2026

👤 Facturé à
Jean Dupont
jean.dupont@email.com
15 Rue de la République
75001 Paris

📋 Détails de la facture
| Description | Qté | PU HT | Total HT |
| --- | --- | --- | --- |
| Développement site web | 1 | 2 500,00 € | 2 500,00 € |
| Hébergement annuel | 1 | 150,00 € | 150,00 € |
| Maintenance mensuelle | 3 | 80,00 € | 240,00 € |
| Formation CMS | 2 | 120,00 € | 240,00 € |

Sous-total HT : 3 130,00 €
TVA 20 % : 626,00 €
Total TTC : 3 756,00 €

📝 Conditions de paiement
Paiement dû sous 15 jours
Virement bancaire
IBAN FR76 1234 5678 9012 3456 7890 123
BIC / SWIFT ABCDEFFXXX

Merci pour votre confiance.`

describe('buildInvoiceModel', () => {
  it('parses a realistic emoji-marked Markdown invoice', () => {
    const m = buildInvoiceModel({ template: 'invoice', markdown: SAMPLE })
    expect(m.invoiceNumber).toBe('FAC-2024-001')
    expect(m.brand).toBe('OPTIX AI')
    expect(m.tagline).toBe('AI SOLUTIONS')
    expect(m.issueDate).toMatch(/25 août 2026/)
    expect(m.dueDate).toMatch(/10 septembre 2026/)
    expect(m.customer).toContain('Jean Dupont')
    expect(m.customer.some(c => c.includes('@'))).toBe(true)
    expect(m.items).toHaveLength(4)
    expect(m.items[0].description).toBe('Développement site web')
    expect(m.subtotal).toBe('3 130,00 €')
    expect(m.taxLabel).toBe('TVA 20 %')
    expect(m.tax).toBe('626,00 €')
    expect(m.total).toBe('3 756,00 €')
    expect(m.paymentTerms.some(t => /paiement d. sous 15 jours/i.test(t))).toBe(
      true
    )
    expect(m.bank.some(b => /IBAN/.test(b))).toBe(true)
    expect(m.footer).toMatch(/Merci/)
  })

  it('also parses the content-body path (documented model output)', () => {
    const m = buildInvoiceModel({ template: 'invoice', content: SAMPLE })
    expect(m.items).toHaveLength(4)
    expect(m.total).toBe('3 756,00 €')
  })

  it('accepts structured invoice fields directly', () => {
    const m = buildInvoiceModel({
      template: 'invoice',
      invoice: {
        brand: 'ACME',
        invoiceNumber: 'INV-9',
        customer: ['Jane'],
        items: [
          {
            description: 'Consulting',
            qty: '2',
            unitPrice: '100,00 €',
            total: '200,00 €'
          }
        ],
        subtotal: '200,00 €',
        tax: '40,00 €',
        total: '240,00 €'
      }
    })
    expect(m.brand).toBe('ACME')
    expect(m.items).toHaveLength(1)
    expect(m.total).toBe('240,00 €')
  })
})

describe('renderInvoiceHtml', () => {
  const m = buildInvoiceModel({ template: 'invoice', markdown: SAMPLE })

  it('produces a composed invoice, never a linear Markdown dump', () => {
    const html = renderInvoiceHtml(m, '#2563eb')
    // No emoji section markers leaked into the PDF.
    expect(html).not.toMatch(/👤|📋|📝/)
    // Real composition blocks present.
    expect(html).toMatch(/Facturé à/)
    expect(html).toMatch(/Total TTC/)
    expect(html).toMatch(/OPTIX AI/)
    expect(html).toMatch(/FAC-2024-001/)
    expect(html).toMatch(/Développement site web/)
    // Not a bullet list of emoji headers.
    expect(html).not.toMatch(/<li>👤/)
    expect(html).not.toMatch(/📋 Détails/)
  })
})
