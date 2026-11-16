import { useMemo } from 'react'

// True when the form no longer matches what was last saved.
export default function useDirty(current, saved) {
  return useMemo(() => JSON.stringify(current) !== JSON.stringify(saved), [current, saved])
}
