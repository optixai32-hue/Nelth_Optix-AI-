/**
 * Routing metadata for the official Anthropic Agent Skills under
 * `skills-main/`. These skills ship a minimal SKILL.md frontmatter
 * (`name` + `description` only) and no `metadata.triggers` block, so the
 * keyword Skill Router cannot match them. To integrate them into the existing
 * router WITHOUT editing their SKILL.md (rule: keep SKILL.md as the source of
 * instructions), we supply domain + trigger phrases here and merge them into
 * the scanned `SkillMeta` at registry-build time.
 *
 * Triggers are plain-language phrases the user might type. The router scores
 * multi-word phrases highest, then single tokens. Keep them specific enough to
 * avoid false positives against the generic code-quality prompt.
 */
export interface SkillsMainRouting {
  domain: string
  triggers: string[]
  relatedSkills: string[]
}

export const SKILLS_MAIN_ROUTING: Record<string, SkillsMainRouting> = {
  'frontend-design': {
    domain: 'frontend',
    triggers: [
      'frontend',
      'front-end',
      'web design',
      'website',
      'webpage',
      'landing page',
      'ui',
      'user interface',
      'css',
      'html',
      'typography',
      'visual design',
      'hero section',
      'responsive design',
      'design system',
      'creative direction',
      'site web',
      'page web',
      'site vitrine',
      "page d'accueil",
      'portfolio',
      'créer un site',
      'creer un site'
    ],
    relatedSkills: ['web-artifacts-builder', 'theme-factory', 'canvas-design']
  },
  'web-artifacts-builder': {
    domain: 'web',
    triggers: [
      'artifact',
      'web artifact',
      'react app',
      'react component',
      'single-page app',
      'spa',
      'html prototype',
      'interactive prototype',
      'code sandbox',
      'build a web',
      'build an app',
      'self-contained html',
      'interactive demo',
      'prototype interactif',
      'démo interactive',
      'demo interactive',
      'application web',
      'application interactive'
    ],
    relatedSkills: ['frontend-design', 'webapp-testing']
  },
  'webapp-testing': {
    domain: 'testing',
    triggers: [
      'test',
      'e2e',
      'end to end',
      'playwright',
      'browser test',
      'automated test',
      'ui test',
      'qa',
      'verify app',
      'run tests',
      'debug app',
      'smoke test',
      'check the app works'
    ],
    relatedSkills: ['web-artifacts-builder', 'web-artifacts-builder']
  },
  'mcp-builder': {
    domain: 'mcp',
    triggers: [
      'mcp',
      'model context protocol',
      'mcp server',
      'tool server',
      'build a server',
      'integration server',
      'protocol',
      'expose tools',
      'connect to'
    ],
    relatedSkills: ['skill-creator']
  },
  'skill-creator': {
    domain: 'meta',
    triggers: [
      'create a skill',
      'new skill',
      'write a skill',
      'author a skill',
      'make a skill',
      'skill specification',
      'skill creator',
      'package a skill'
    ],
    relatedSkills: ['mcp-builder']
  },
  'theme-factory': {
    domain: 'theme',
    triggers: [
      'theme',
      'color palette',
      'color scheme',
      'design system',
      'palette',
      'dark theme',
      'light theme',
      'brand colors',
      'moodboard',
      'color tokens'
    ],
    relatedSkills: ['frontend-design']
  },
  'canvas-design': {
    domain: 'canvas',
    triggers: [
      'canvas',
      'html canvas',
      'generative art',
      'canvas animation',
      'poster',
      'creative coding',
      '2d canvas',
      'visual',
      'banner',
      'jeu canvas',
      'affiche',
      'bannière',
      'banniere'
    ],
    relatedSkills: ['frontend-design', 'algorithmic-art']
  },
  'algorithmic-art': {
    domain: 'art',
    triggers: [
      'algorithmic art',
      'generative',
      'creative coding',
      'animation',
      'shader',
      'processing',
      'p5',
      'generative art',
      'art génératif',
      'art generatif',
      'génératif',
      'generatif'
    ],
    relatedSkills: ['canvas-design', 'frontend-design']
  },
  'game-developer': {
    domain: 'game',
    triggers: [
      'game',
      'video game',
      'jeu',
      'jeux',
      'jouer',
      'jouable',
      'mini-jeu',
      'mini jeu',
      'jeu vidéo',
      'jeu video',
      'snake',
      'tetris',
      'pong',
      'pacman',
      'pac-man',
      'casse-briques',
      'casse briques',
      'space invaders',
      'flappy',
      'platformer',
      'jeu de plateforme',
      'tower defense',
      'morpion',
      'démineur',
      'demineur',
      'minesweeper',
      '2048',
      'échecs',
      'echecs',
      'jeu de mémoire',
      'jeu de memoire',
      'memory game',
      'runner',
      'jeu de course',
      'quiz game',
      'jeu quiz'
    ],
    relatedSkills: ['canvas-design', 'frontend-design']
  },
  docx: {
    domain: 'documents',
    triggers: [
      'docx',
      'word document',
      'word',
      'document',
      'doc',
      'report',
      'resume',
      'cover letter',
      'letter',
      '.docx'
    ],
    relatedSkills: ['pdf']
  },
  pptx: {
    domain: 'presentations',
    triggers: [
      'pptx',
      'powerpoint',
      'presentation',
      'slides',
      'deck',
      'slide',
      'keynote',
      '.pptx'
    ],
    relatedSkills: ['docx', 'pdf']
  },
  xlsx: {
    domain: 'spreadsheets',
    triggers: [
      'xlsx',
      'excel',
      'spreadsheet',
      'sheet',
      'workbook',
      'csv to excel',
      'formula',
      '.xlsx',
      'recalc'
    ],
    relatedSkills: ['docx']
  },
  pdf: {
    domain: 'pdf',
    triggers: [
      'pdf',
      'fillable form',
      'form field',
      'fill pdf',
      'pdf form',
      'annotate pdf',
      'extract form',
      'fillable',
      'pdf form field'
    ],
    relatedSkills: ['docx', 'pptx']
  },
  'brand-guidelines': {
    domain: 'brand',
    triggers: [
      'brand',
      'brand guidelines',
      'logo',
      'brand identity',
      'style guide',
      'brand book',
      'visual identity',
      'brand kit'
    ],
    relatedSkills: ['theme-factory', 'frontend-design']
  },
  'doc-coauthoring': {
    domain: 'writing',
    triggers: [
      'co-author',
      'document collaboration',
      'writing',
      'ghostwrite',
      'draft document',
      'edit document',
      'writing partner',
      'help me write'
    ],
    relatedSkills: ['docx']
  },
  'discernment-nudge': {
    domain: 'reasoning',
    triggers: [
      'discernment',
      'critical thinking',
      'bias',
      'reasoning',
      'judgment',
      'epistemic',
      'think carefully',
      'question assumptions'
    ],
    relatedSkills: ['the-fool']
  },
  'internal-comms': {
    domain: 'comms',
    triggers: [
      'internal comms',
      'announcement',
      'newsletter',
      'company update',
      'internal communication',
      'all-hands',
      'memo',
      'faq',
      'status update'
    ],
    relatedSkills: ['doc-coauthoring']
  },
  'claude-api': {
    domain: 'api',
    triggers: [
      'claude api',
      'anthropic api',
      'api',
      'sdk',
      'model api',
      'streaming api',
      'tool use',
      'messages api',
      'anthropic sdk'
    ],
    relatedSkills: ['mcp-builder']
  },
  'claude-academy-guide': {
    domain: 'education',
    triggers: [
      'claude academy',
      'course',
      'curriculum',
      'lesson',
      'teaching',
      'learning',
      'tutorial',
      'training',
      'workshop'
    ],
    relatedSkills: []
  },
  'slack-gif-creator': {
    domain: 'gif',
    triggers: [
      'gif',
      'slack',
      'animated gif',
      'sticker',
      'reaction gif',
      'emoji',
      'slack gif',
      'loop'
    ],
    relatedSkills: ['canvas-design']
  }
}

/**
 * Routing metadata for the code/programming skills that live under
 * `lib/skills/claude-skills/`. These ship a real `metadata.triggers` block, but
 * their triggers are language-specific and English-only, so generic or French
 * coding requests ("écris du code", "crée une fonction", "write a function")
 * never match. We SUPPLEMENT (never overwrite) their triggers here with
 * natural-language phrases so code tasks actually select a skill. `applyRoutingOverrides`
 * merges these additively with each skill's own triggers.
 */
export const SKILLS_CLAUDE_ROUTING: Record<string, SkillsMainRouting> = {
  'python-pro': {
    domain: 'language',
    triggers: [
      'python code',
      'code python',
      'python script',
      'script python',
      'python function',
      'fonction python',
      'écris du code python',
      'du code python',
      'python development',
      'type hints',
      'async python',
      'pytest',
      'mypy',
      'dataclasses'
    ],
    relatedSkills: ['fastapi-expert', 'devops-engineer']
  },
  'typescript-pro': {
    domain: 'language',
    triggers: [
      'typescript code',
      'code typescript',
      'ts code',
      'du code typescript',
      'type safety',
      'generics',
      'tRPC',
      'type guards',
      'discriminated unions',
      'tsconfig'
    ],
    relatedSkills: ['fullstack-guardian', 'api-designer']
  },
  'javascript-pro': {
    domain: 'language',
    triggers: [
      'javascript code',
      'code javascript',
      'js code',
      'du code javascript',
      'vanilla javascript',
      'node.js',
      'es2023',
      'async await',
      'web workers',
      'fetch api'
    ],
    relatedSkills: ['fullstack-guardian']
  },
  'react-expert': {
    domain: 'frontend',
    triggers: [
      'react code',
      'code react',
      'composant react',
      'crée un composant react',
      'jsx',
      'hooks',
      'usestate',
      'useeffect',
      'server components',
      'react 19',
      'suspense'
    ],
    relatedSkills: ['fullstack-guardian', 'playwright-expert', 'test-master']
  },
  'vue-expert': {
    domain: 'frontend',
    triggers: ['vue code', 'code vue', 'composant vue', 'vuejs'],
    relatedSkills: ['fullstack-guardian']
  },
  'code-reviewer': {
    domain: 'quality',
    triggers: [
      'review code',
      'code review',
      'refactor',
      'analyze code',
      'code quality',
      'pull request',
      'pr review',
      'relis le code',
      'revue de code',
      'améliore ce code'
    ],
    relatedSkills: ['security-reviewer', 'test-master', 'architecture-designer']
  },
  'api-designer': {
    domain: 'api',
    triggers: [
      'rest api',
      'api rest',
      'crée une api',
      'design api',
      'endpoint',
      'openapi'
    ],
    relatedSkills: ['mcp-developer']
  },
  'nextjs-developer': {
    domain: 'frontend',
    triggers: [
      'next.js',
      'nextjs',
      'app router',
      'page.tsx',
      'crée une app next'
    ],
    relatedSkills: ['react-expert']
  },
  'sql-pro': {
    domain: 'database',
    triggers: ['sql query', 'requête sql', 'base de données', 'database query'],
    relatedSkills: ['database-optimizer', 'postgres-pro']
  },
  'java-architect': {
    domain: 'language',
    triggers: ['java code', 'code java', 'spring', 'spring boot'],
    relatedSkills: ['microservices-architect']
  },
  'golang-pro': {
    domain: 'language',
    triggers: ['go code', 'code go', 'golang'],
    relatedSkills: []
  },
  'rust-engineer': {
    domain: 'language',
    triggers: ['rust code', 'code rust'],
    relatedSkills: []
  },
  'cpp-pro': {
    domain: 'language',
    triggers: ['c++ code', 'code c++', 'cpp'],
    relatedSkills: []
  },
  'csharp-developer': {
    domain: 'language',
    triggers: ['c# code', 'code c#', 'csharp', 'dotnet'],
    relatedSkills: []
  }
}

/**
 * Slugs that live under `skills-main/` (used to know when to apply overrides).
 * Kept in sync with the keys of SKILLS_MAIN_ROUTING.
 */
export const SKILLS_MAIN_SLUGS = new Set(Object.keys(SKILLS_MAIN_ROUTING))
