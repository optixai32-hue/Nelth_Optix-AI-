/**
 * Turns assistant markdown into speakable plain text. Tables, code, links,
 * emojis and URLs would sound awful (or leak) through TTS — strip them.
 * Exported for unit testing.
 */
export function stripMarkdownForSpeech(input: string): string {
  let text = input ?? ''
  // Fenced code blocks (drop entirely — never read code aloud).
  text = text.replace(/```[\s\S]*?```/g, ' ')
  // Images keep alt text, links keep the label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Inline code keeps its content.
  text = text.replace(/`([^`]*)`/g, '$1')
  // Headings, quotes, list markers.
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^>\s?/gm, '')
  text = text.replace(/^(\s*[-*+]|\s*\d+[.)])\s+/gm, '')
  // Markdown tables: cell separators become pauses, divider rows go away.
  text = text.replace(/^\s*\|?[\s:|-]+\|[\s:|.-]*$/gm, '')
  text = text.replace(/\|/g, '. ')
  // Bold / italic / strikethrough markers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
  text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1$2')
  text = text.replace(/~~(.*?)~~/g, '$1')
  // HTML tags + entities.
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  // Bare URLs.
  text = text.replace(/https?:\/\/\S+/g, '')
  // Emojis and pictographs (broad ranges — TTS would spell or skip them).
  text = text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu,
    ''
  )
  // Collapse whitespace.
  text = text
    .split('\n')
    .map(line => line.trim().replace(/[ \t]+/g, ' '))
    .filter(Boolean)
    .join('\n')
  return text.trim().slice(0, 2000)
}
