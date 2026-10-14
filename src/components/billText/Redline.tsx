import type { TextDiffPart, TextMark } from '../../types'
import styles from './Redline.module.css'

// A redline of bill text. Removed words are in <del>, added words are in
// <ins>. Struck and underlined text keeps the marks of the printed bill:
// struck text is removed from current law, underlined text is new law.

interface Piece {
  op: TextDiffPart['op']
  text: string
  mark: TextMark
}

/** The parts as paragraphs. A "\n" run starts a new paragraph. */
export function toParagraphs(parts: TextDiffPart[]): Piece[][] {
  const paragraphs: Piece[][] = [[]]
  for (const part of parts) {
    for (const [text, mark] of part.runs) {
      if (text === '\n') {
        paragraphs.push([])
        continue
      }
      paragraphs[paragraphs.length - 1].push({ op: part.op, text, mark })
    }
  }
  return paragraphs.filter((p) => p.length > 0)
}

const markClass = (mark: TextMark) =>
  [mark & 1 ? styles.struck : '', mark & 2 ? styles.underlined : ''].filter(Boolean).join(' ') || undefined

function PieceView({ piece }: { piece: Piece }) {
  const text = <span className={markClass(piece.mark)}>{piece.text}</span>
  if (piece.op === '-') return <del className={styles.removed}>{text}</del>
  if (piece.op === '+') return <ins className={styles.added}>{text}</ins>
  return text
}

export function RedlineParagraph({ pieces }: { pieces: Piece[] }) {
  return (
    <p className={styles.paragraph} data-changed={pieces.some((p) => p.op !== '=') || undefined}>
      {pieces.map((piece, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <PieceView piece={piece} />
        </span>
      ))}
    </p>
  )
}

export function RedlineLegend() {
  return (
    <div className={styles.legend}>
      <span>
        <del className={styles.removed}>Removed</del> and <ins className={styles.added}>added</ins> in the newer text.
      </span>
      <span>
        <span className={styles.struck}>Struck</span> and <span className={styles.underlined}>underlined</span> text
        is as printed in the bill: removed from and added to current law.
      </span>
    </div>
  )
}
