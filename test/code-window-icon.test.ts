import { describe, expect, it } from 'vitest'
import { codeWindowIcon } from '../setup/code-window-icon'

describe('codeWindowIcon', () => {
  it('gives Kotlin fences the Kotlin mark unless a modifier names a transport or build tool', () => {
    expect(codeWindowIcon('kotlin')).toBe('kotlin')
    expect(codeWindowIcon('kts', 'gradle')).toBe('gradle')
    expect(codeWindowIcon('kotlin', 'jdbc {1,3}')).toBe('jdbc')
  })

  it('marks Kotlin code about an Arrow library with the Arrow icon', () => {
    expect(codeWindowIcon('kotlin', 'arrow')).toBe('arrow')
    expect(codeWindowIcon('kotlin', 'arrow {2-4}')).toBe('arrow')
  })

  it('marks Ktor code with the Ktor icon', () => {
    expect(codeWindowIcon('kotlin', 'ktor')).toBe('ktor')
    expect(codeWindowIcon('kts', 'ktor {1}')).toBe('ktor')
  })

  it('renders a console fence as an output panel', () => {
    expect(codeWindowIcon('console')).toBe('output')
  })

  it('leaves other fences plain', () => {
    expect(codeWindowIcon('txt')).toBeUndefined()
    expect(codeWindowIcon('json')).toBeUndefined()
  })
})
