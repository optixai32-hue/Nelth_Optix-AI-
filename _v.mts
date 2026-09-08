import { classifyVisualIntent } from '@/lib/agents/visual-intent'

const cases: [string, 'required' | 'recommended' | 'not_needed'][] = [
  // Explicit requests → required
  ['Fais-moi un mindmap', 'required'],
  ['Crée un flowchart', 'required'],
  ['Montre-moi l’architecture', 'required'],
  ['Fais un graphique', 'required'],
  ['Dessine le workflow', 'required'],
  ['Visualise ce processus', 'required'],
  ['Crée une landing page', 'required'],
  ['Build a React component', 'required'],
  // Complex / data / comparison / planning → recommended
  ['Compare React vs Vue', 'recommended'],
  ['Explique l’architecture d’un système', 'recommended'],
  ['Les statistiques d’évolution des ventes', 'recommended'],
  ['Roadmap du projet sur plusieurs mois', 'recommended'],
  // Should NOT visualize → not_needed
  ['Bonjour', 'not_needed'],
  ['C’est quoi Docker ?', 'not_needed'],
  ['Traduis ce texte en français', 'not_needed'],
  ['Comment fonctionne une API ?', 'not_needed'],
  ['Donne-moi une fonction JavaScript', 'not_needed'],
  ['Résume ce texte', 'not_needed'],
  ['Quelle est la capitale de la France ?', 'not_needed']
]

let pass = 0
for (const [q, expected] of cases) {
  const r = classifyVisualIntent(q)
  const ok = r.intent === expected
  if (ok) pass++
  console.log(
    `${ok ? 'OK ' : 'XX '} [${r.intent.padEnd(12)} s=${r.score}] ${q}  (${ok ? '' : 'expected ' + expected + ' — ' + r.reason})`
  )
}
console.log(`\n${pass}/${cases.length} passed`)
