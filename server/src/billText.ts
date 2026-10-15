// Bill text from the Legislature's PDF files: extraction, file names, and
// comparison.
//
// A Montana bill marks changes to current law in the text itself. Struck
// text is removed from the law, and underlined text is new. The PDF draws
// these marks as lines, not as text styles. So the extraction compares the
// position of each drawn line with the text baseline. A line through the
// middle of the text is a strikethrough. A line at the baseline is an
// underline.
//
// The text is stored as paragraphs, not as PDF lines. Line breaks change
// from one version to the next, but paragraphs stay the same.
import { getDocumentProxy } from 'unpdf'
import { diffArrays } from 'diff'

/** A mark on bill text: 0 none, 1 struck, 2 underlined, 3 both. */
export type Mark = 0 | 1 | 2 | 3
/** Text with one mark. */
export type Run = [text: string, mark: Mark]
/** One paragraph of bill text. */
export type Paragraph = Run[]

// ---------------------------------------------------------------------------
// File names

export type VersionKey = string // '1', '2', ... or 'X' (enrolled)

/**
 * The version of a bill version file, for example "SB0001_2(3).pdf" is
 * version 2, copy 3. Other files (for example "HB0002_X-pre_veto.pdf" or
 * "HB0002.AP.003.pdf") give null.
 */
export function parseVersionFileName(fileName: string): { key: VersionKey; copy: number } | null {
  const m = /^[A-Z]+\d+_(\d+|X)(?:\((\d+)\))?\.pdf$/i.exec(fileName)
  if (!m) return null
  const key = m[1].toUpperCase()
  if (key === '0') return null
  return { key, copy: m[2] ? Number(m[2]) : 0 }
}

/** The name that people see for a version. */
export function versionLabel(key: VersionKey): string {
  if (key === 'X') return 'Enrolled'
  if (key === '1') return 'Introduced'
  return `Version ${key}`
}

/** The order of versions: 1, 2, 3, ..., then X. */
export function versionOrder(key: VersionKey): number {
  return key === 'X' ? 1000 : Number(key)
}

export interface AmendmentFile {
  billVersion: number
  number: number
  /** The section letter of a large bill (HB 2 uses A to E), or null. */
  section: string | null
  kind: 'full' | 'condensed' | 'not condensed'
  copy: number
  /** The name without the copy suffix. Copies of one amendment have the same base. */
  base: string
}

/**
 * The amendment of an "amendments in context" file. Examples:
 *   SB0001.001.005_Amendments-in-Context_final-full.pdf      version 1, number 5
 *   HB0002.002.001.A.003_Amendments-in-Context_final-full.pdf version 2, section A, number 3
 */
export function parseAmendmentFileName(fileName: string): AmendmentFile | null {
  const m =
    /^([A-Z]+\d+\.(\d{3})\.(\d{3})(?:\.([A-Z])\.(\d{3}))?)_Amendments-in-Context_final-(full|condensed|not condensed)(?:\((\d+)\))?\.pdf$/i.exec(
      fileName,
    )
  if (!m) return null
  return {
    billVersion: Number(m[2]),
    number: Number(m[5] ?? m[3]),
    section: m[4] ? m[4].toUpperCase() : null,
    kind: m[6].toLowerCase() as AmendmentFile['kind'],
    copy: m[7] ? Number(m[7]) : 0,
    base: m[1].toUpperCase(),
  }
}

// ---------------------------------------------------------------------------
// Extraction

interface Item {
  str: string
  x: number
  y: number
  width: number
  height: number
}

interface Segment {
  x0: number
  x1: number
  y: number
}

type Matrix = [number, number, number, number, number, number]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** The horizontal lines that a page draws, in page coordinates. */
async function horizontalSegments(page: PdfPage, OPS: Record<string, number>): Promise<Segment[]> {
  const ops = await page.getOperatorList()
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []
  const segments: Segment[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix)
    else if (fn === OPS.constructPath) {
      // args[2] is the bounding box of the path: [minX, minY, maxX, maxY].
      const box = args[2] as ArrayLike<number> | undefined
      if (!box) continue
      const [ax, ay] = apply(ctm, box[0], box[1])
      const [bx, by] = apply(ctm, box[2], box[3])
      const x0 = Math.min(ax, bx)
      const x1 = Math.max(ax, bx)
      const height = Math.abs(by - ay)
      if (height < 2 && x1 - x0 > 2) segments.push({ x0, x1, y: (ay + by) / 2 })
    }
  }
  return segments
}

// Character widths of Arial (the bill font), in 1/1000 of the font size. The
// text items do not give the position of each character, so the extraction
// shares the item width between the characters with these widths.
const ARIAL: Record<string, number> = {
  ' ': 278, '.': 278, ',': 278, ';': 278, ':': 278, '(': 333, ')': 333, '-': 333, '/': 278, "'": 191, '"': 355,
  '\u2013': 556, '\u2014': 1000, '\u201c': 333, '\u201d': 333, '\u2018': 222, '\u2019': 222, '%': 889, '&': 667,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
}
const glyphWidth = (c: string) => ARIAL[c] ?? 556

/** The [start, length] of each word. A word also ends between ")" and "(". */
function wordSpans(chars: string[]): [number, number][] {
  const spans: [number, number][] = []
  let start = -1
  for (let i = 0; i <= chars.length; i++) {
    const space = i === chars.length || /\s/.test(chars[i])
    if (start >= 0 && (space || (chars[i] === '(' && chars[i - 1] === ')'))) {
      spans.push([start, i - start])
      start = -1
    }
    if (!space && start < 0) start = i
  }
  return spans
}

/**
 * The mark of each character of an item, from the lines across it. The
 * character positions are estimates, so each word gets one mark: the mark
 * of most of its characters. A word such as "(k)(g)" (an old and a new
 * subsection letter) is two words here.
 */
function charMarks(item: Item, segments: Segment[]): Mark[] {
  const chars = [...item.str]
  const n = chars.length
  const marks: Mark[] = new Array(n).fill(0)
  if (n === 0 || item.width <= 0) return marks
  const widths = chars.map(glyphWidth)
  const scale = item.width / widths.reduce((a, b) => a + b, 0)
  const centers: number[] = []
  let x = item.x
  for (const w of widths) {
    centers.push(x + (w * scale) / 2)
    x += w * scale
  }
  for (const s of segments) {
    if (s.x1 <= item.x || s.x0 >= item.x + item.width) continue
    const rise = s.y - item.y
    let bit: Mark
    if (rise > 0.15 * item.height && rise < 0.6 * item.height) bit = 1
    else if (rise > -0.35 * item.height && rise <= 0.15 * item.height) bit = 2
    else continue
    for (let i = 0; i < n; i++) {
      if (centers[i] >= s.x0 && centers[i] <= s.x1) marks[i] = (marks[i] | bit) as Mark
    }
  }

  // One mark for each word.
  for (const [start, len] of wordSpans(chars)) {
    let strike = 0
    let under = 0
    for (let i = start; i < start + len; i++) {
      if (marks[i] & 1) strike++
      if (marks[i] & 2) under++
    }
    const mark = ((strike * 2 > len ? 1 : 0) | (under * 2 > len ? 2 : 0)) as Mark
    for (let i = start; i < start + len; i++) marks[i] = mark
  }
  // A space between two words with the same mark gets that mark.
  for (let i = 0; i < n; i++) {
    if (!/\s/.test(chars[i])) continue
    const before = i > 0 ? marks[i - 1] : 0
    const after = i + 1 < n ? marks[i + 1] : 0
    marks[i] = before === after ? before : 0
  }
  return marks
}

// The minimal parts of a pdf.js page that this file uses.
interface PdfPage {
  view: number[]
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>
  getTextContent(): Promise<{ items: unknown[] }>
}

function pushText(paragraph: Paragraph, text: string, mark: Mark) {
  const last = paragraph[paragraph.length - 1]
  if (last && last[1] === mark) last[0] += text
  else paragraph.push([text, mark])
}

/**
 * The text of a bill PDF as paragraphs with marks. Only the numbered lines
 * are bill text. The page headers and footers have no line numbers, so the
 * extraction ignores them.
 */
export async function extractBillText(pdfBytes: Uint8Array): Promise<Paragraph[]> {
  const pdf = await getDocumentProxy(pdfBytes)
  const { OPS } = (await import('unpdf/pdfjs')) as unknown as { OPS: Record<string, number> }
  const paragraphs: Paragraph[] = []
  let current: Paragraph = []
  let leftMargin = Infinity

  const endParagraph = () => {
    const text = current.map((r) => r[0]).join('').trim()
    if (text) {
      // Remove the space at the start and the end.
      current[0][0] = current[0][0].replace(/^\s+/, '')
      current[current.length - 1][0] = current[current.length - 1][0].replace(/\s+$/, '')
      paragraphs.push(current.filter((r) => r[0] !== ''))
    }
    current = []
  }

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = (await pdf.getPage(p)) as unknown as PdfPage
    const segments = await horizontalSegments(page, OPS)
    const content = await page.getTextContent()
    const items: Item[] = []
    for (const raw of content.items as { str?: string; transform?: number[]; width?: number }[]) {
      if (typeof raw.str !== 'string' || !raw.transform) continue
      items.push({
        str: raw.str,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width ?? 0,
        height: Math.abs(raw.transform[3]) || 10,
      })
    }

    // Line numbers: a number at the left edge of the page. The enrolled
    // version has no line numbers. Then the bill text is all the text
    // between the page header and the page footer.
    const numbers = items.filter((it) => /^\d+$/.test(it.str.trim()) && it.x < 66)
    const numbered = numbers.length > 0
    const numberSet = new Set(numbers)
    const pageTop = page.view[3] ?? 792
    const lineYs: number[] = []
    if (numbered) lineYs.push(...numbers.map((it) => it.y))
    const lines = new Map<number, Item[]>()
    for (const it of items) {
      if (numberSet.has(it)) continue
      let lineY = lineYs.find((y) => Math.abs(y - it.y) < 2)
      if (lineY === undefined) {
        if (numbered || it.y < 60 || it.y > pageTop - 60) continue
        lineY = it.y
        lineYs.push(lineY)
      }
      const list = lines.get(lineY) ?? []
      list.push(it)
      lines.set(lineY, list)
    }
    let previousY: number | null = null

    // Lines from the top of the page to the bottom.
    for (const y of [...new Set(lineYs)].sort((a, b) => b - a)) {
      const lineItems = (lines.get(y) ?? []).filter((it) => it.str !== '').sort((a, b) => a.x - b.x)
      const firstText = lineItems.find((it) => it.str.trim() !== '')
      if (!firstText) {
        // A blank numbered line ends the paragraph.
        endParagraph()
        continue
      }
      leftMargin = Math.min(leftMargin, firstText.x)
      // An indented line starts a new paragraph. A line at the left margin
      // continues the paragraph. With no line numbers, a larger space
      // between lines (a blank line) also starts a new paragraph.
      const gap = previousY === null ? 0 : previousY - y
      previousY = y
      if (firstText.x > leftMargin + 4 || (!numbered && gap > 30)) endParagraph()
      else if (current.length > 0) pushText(current, ' ', 0)

      for (const it of lineItems) {
        const marks = charMarks(it, segments)
        const chars = [...it.str]
        let start = 0
        for (let i = 1; i <= chars.length; i++) {
          if (i === chars.length || marks[i] !== marks[start]) {
            pushText(current, chars.slice(start, i).join(''), marks[start])
            start = i
          }
        }
      }
    }
  }
  endParagraph()

  // Collapse runs of spaces.
  return paragraphs.map((para) => para.map(([text, mark]) => [text.replace(/\s+/g, ' '), mark] as Run))
}

/** The plain text of the paragraphs, with no marks. */
export function plainText(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => p.map((r) => r[0]).join('')).join('\n\n')
}

// ---------------------------------------------------------------------------
// Comparison

/** A word with its mark, or a paragraph break (text "\n"). */
export interface Token {
  text: string
  mark: Mark
}

const BREAK: Token = { text: '\n', mark: 0 }

export function tokenize(paragraphs: Paragraph[]): Token[] {
  const tokens: Token[] = []
  paragraphs.forEach((para, i) => {
    if (i > 0) tokens.push(BREAK)
    for (const [text, mark] of para) {
      for (const word of text.split(/\s+/)) if (word) tokens.push({ text: word, mark })
    }
  })
  return tokens
}

/** One part of a comparison: tokens that are the same, removed, or added. */
export interface DiffPart {
  op: '=' | '-' | '+'
  tokens: Token[]
}

// Text that a chamber adds by amendment is in capital letters in the next
// version, and in normal letters in the enrolled version. That is not a
// change, so the comparison ignores the case of letters.
const sameToken = (a: Token, b: Token) => a.mark === b.mark && a.text.toLowerCase() === b.text.toLowerCase()

// A larger edit makes the word comparison slow. Then the comparison is by
// paragraph.
const MAX_EDIT_LENGTH = 20_000

/**
 * The changes from one text to another, word by word. A word that only got
 * a new mark (for example, it is struck now) is a change too.
 */
export function diffParagraphs(from: Paragraph[], to: Paragraph[]): DiffPart[] {
  const a = tokenize(from)
  const b = tokenize(to)
  const result = diffArrays(a, b, { comparator: sameToken, maxEditLength: MAX_EDIT_LENGTH })
  if (result) {
    // The same words come from the newer text, with its letter case.
    let ia = 0
    let ib = 0
    return result.map((c) => {
      const n = c.count ?? c.value.length
      if (c.removed) {
        ia += n
        return { op: '-' as const, tokens: c.value }
      }
      const tokens = b.slice(ib, ib + n)
      ib += n
      if (!c.added) ia += n
      return { op: c.added ? ('+' as const) : ('=' as const), tokens }
    })
  }
  // Paragraph by paragraph.
  const key = (p: Paragraph) => JSON.stringify(p)
  const byParagraph = diffArrays(from.map(key), to.map(key), { comparator: (x, y) => x.toLowerCase() === y.toLowerCase() })
  const parts: DiffPart[] = []
  for (const c of byParagraph) {
    const tokens = tokenize(c.value.map((k) => JSON.parse(k) as Paragraph))
    parts.push({ op: c.added ? '+' : c.removed ? '-' : '=', tokens: [...tokens, BREAK] })
  }
  return parts
}

/** One changed paragraph of a comparison, with the words before and after the change. */
export interface ChangedParagraph {
  parts: DiffPart[]
}

/**
 * The changes in a form that people can read. A word that only gets a strike
 * (the newer text removes it from the bill) is in the diff two times: as a
 * removed plain word and as an added struck word. This function shows such a
 * word one time, as removed. Other changes of a mark only are not changes
 * here. After this function, a removed part means "removed" and an added
 * part means "added", with no other meaning from the marks.
 */
export function readableChanges(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  const emit = (op: DiffPart['op'], token: Token) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.tokens.push(token)
    else out.push({ op, tokens: [token] })
  }
  const sameText = (a: Token, b: Token) => a.text.toLowerCase() === b.text.toLowerCase()

  let i = 0
  while (i < parts.length) {
    if (parts[i].op === '=') {
      for (const t of parts[i].tokens) emit('=', t)
      i++
      continue
    }
    // A hunk: the removed and added words between two unchanged parts.
    const removed: Token[] = []
    const added: Token[] = []
    while (i < parts.length && parts[i].op !== '=') {
      ;(parts[i].op === '-' ? removed : added).push(...parts[i].tokens)
      i++
    }
    let r = 0
    let a = 0
    for (const c of diffArrays(removed, added, { comparator: sameText })) {
      const n = c.count ?? c.value.length
      for (let k = 0; k < n; k++) {
        if (c.removed) emit('-', removed[r++])
        else if (c.added) {
          const token = added[a++]
          // New struck text: the newer text removes it from the bill.
          emit(token.mark & 1 ? '-' : '+', token)
        } else {
          const before = removed[r++]
          const after = added[a++]
          emit(after.mark & 1 && !(before.mark & 1) ? '-' : '=', after)
        }
      }
    }
  }
  return out
}

/** Only the paragraphs that have a change. */
export function changedParagraphs(parts: DiffPart[]): ChangedParagraph[] {
  const paragraphs: DiffPart[][] = [[]]
  for (const part of parts) {
    for (const token of part.tokens) {
      const current = paragraphs[paragraphs.length - 1]
      if (token.text === '\n' && part.op === '=') {
        paragraphs.push([])
        continue
      }
      const last = current[current.length - 1]
      if (last && last.op === part.op) last.tokens.push(token)
      else current.push({ op: part.op, tokens: [token] })
    }
  }
  return paragraphs.filter((p) => p.some((part) => part.op !== '=')).map((p) => ({ parts: p }))
}

/**
 * A text form of changed paragraphs for the AI summary. Removed words are
 * in [-...-], added words are in {+...+}. Struck text (removed from current
 * law) is in <s>...</s>, and underlined text (new law) is in <u>...</u>.
 */
export function describeChanges(changes: ChangedParagraph[], maxChars = 12_000): string {
  const words = (tokens: Token[]) =>
    tokens
      .map((t) => (t.text === '\n' ? '¶' : t.mark & 1 ? `<s>${t.text}</s>` : t.mark & 2 ? `<u>${t.text}</u>` : t.text))
      .join(' ')
      .replace(/<\/s> <s>/g, ' ')
      .replace(/<\/u> <u>/g, ' ')
  let out = ''
  for (const change of changes) {
    const line = change.parts
      .map((p) => (p.op === '=' ? words(p.tokens) : p.op === '-' ? `[-${words(p.tokens)}-]` : `{+${words(p.tokens)}+}`))
      .join(' ')
    if (out.length + line.length > maxChars) {
      out += '\n(More changes are not shown.)'
      break
    }
    out += (out ? '\n\n' : '') + line
  }
  return out
}
