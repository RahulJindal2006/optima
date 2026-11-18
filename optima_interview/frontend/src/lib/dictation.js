// Turning what the browser's speech recognition hears into text that reads like writing.
// Plain functions over text: no microphone and no page, so they can be checked with words alone.
//
// Chrome 151 and later can punctuate by itself (SpeechRecognition.unspokenPunctuation). Where that is
// there, it is used and this file only joins the pieces. Everywhere else the recogniser hands back bare
// lower-case words, and this file does what it safely can: a capital at the start of each sentence, a
// full stop where the speaker paused, and the marks a speaker asks for by name.

const ENDS_SENTENCE = /[.!?…]["')\]]*$/
const ENDS_WITH_MARK = /[.!?…,;:]["')\]]*$/

// A pause this long between one phrase and the next is taken as the end of a sentence. The recogniser
// has already waited about half a second before settling on a phrase, so this is on top of that.
export const SENTENCE_PAUSE_MS = 650

// Whether this browser's recogniser can punctuate by itself.
export function canPunctuate(engine) {
  try {
    return Boolean(engine) && 'unspokenPunctuation' in engine
  } catch {
    return false
  }
}

const capital = (text) => text.replace(/^(\s*["'([]?)(\p{Ll})/u, (_, lead, letter) => lead + letter.toUpperCase())

// "i" on its own is "I", wherever it falls.
const pronoun = (text) => text.replace(/(^|[\s"'(])i(?=$|[\s.,!?;:'’])/g, '$1I')

// Marks asked for by name. Only at the very end of a phrase, where a speaker dictating punctuation puts
// them: "it took a period of weeks" keeps its word, "and then we shipped it period" gets its full stop.
const SPOKEN_AT_END = [
  [/[\s,]*\b(?:full stop|period)$/i, '.'],
  [/[\s,]*\bquestion mark$/i, '?'],
  [/[\s,]*\bexclamation (?:mark|point)$/i, '!'],
  [/[\s,]*\bcomma$/i, ','],
  [/[\s,]*\bsemicolon$/i, ';'],
  [/[\s,]*\bnew paragraph$/i, '\n\n'],
  [/[\s,]*\bnew line$/i, '\n'],
]

export function spokenMarks(piece) {
  let text = piece.trim()
  for (const [pattern, mark] of SPOKEN_AT_END) {
    if (pattern.test(text)) {
      const rest = text.replace(pattern, '')
      // the mark alone ("period") closes what came before; with words in front it closes them
      return { text: rest, mark }
    }
  }
  return { text, mark: '' }
}

// Add one settled phrase to what has been said so far.
//   before      the text so far (typed or dictated)
//   piece       the phrase the recogniser has settled on
//   pauseMs     how long the speaker was silent before this phrase began (0 if not known)
//   punctuated  true when the recogniser punctuates by itself: then nothing is guessed here
export function addPhrase(before, piece, { pauseMs = 0, punctuated = false } = {}) {
  let said = String(piece || '').replace(/\s+/g, ' ').trim()
  if (!said) return before
  let text = before
  let mark = ''
  if (!punctuated) {
    const spoken = spokenMarks(said)
    said = spoken.text
    mark = spoken.mark
    // a real pause after an unfinished sentence: close it before starting the next
    if (said && text.trim() && !ENDS_WITH_MARK.test(text.trimEnd()) && pauseMs >= SENTENCE_PAUSE_MS) text = `${text.trimEnd()}.`
  }
  if (said) {
    const fresh = !text.trim() || ENDS_SENTENCE.test(text.trimEnd()) || /\n\s*$/.test(text)
    said = pronoun(fresh ? capital(said) : said)
    // punctuation that arrives as its own phrase belongs to the word before it
    const glue = !text || /\s$/.test(text) || /^[.,!?;:]/.test(said) ? '' : ' '
    text = `${text}${glue}${said}`
  }
  if (mark) {
    text = text.trimEnd()
    if (mark.startsWith('\n')) text = `${ENDS_WITH_MARK.test(text) || !text ? text : `${text}.`}${mark}`
    else if (text && !ENDS_WITH_MARK.test(text)) text = `${text}${mark}`
  }
  return text
}

// Dictation has stopped: close the last sentence if the speaker left it open.
export function closeDictation(text, { punctuated = false } = {}) {
  const trimmed = text.trimEnd()
  if (punctuated || !trimmed || ENDS_WITH_MARK.test(trimmed)) return text
  return `${trimmed}.`
}

// What to show while a phrase is still being heard: the text so far, then the unsettled words.
export function withInterim(before, interim) {
  const said = String(interim || '').replace(/\s+/g, ' ').trim()
  if (!said) return before
  const fresh = !before.trim() || ENDS_SENTENCE.test(before.trimEnd()) || /\n\s*$/.test(before)
  const glue = !before || /\s$/.test(before) ? '' : ' '
  return `${before}${glue}${pronoun(fresh ? capital(said) : said)}`
}
