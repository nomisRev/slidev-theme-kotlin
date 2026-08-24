export function codeWindowIcon(language: string, meta = ''): string | undefined {
  const modifier = meta.trim().split(/\s+/)[0]

  if (['kotlin', 'kt', 'kts'].includes(language) && modifier === 'gradle')
    return 'gradle'
  if (language === 'yaml' && modifier === 'toolchain')
    return 'amper'
  if (language === 'xml' && modifier === 'maven')
    return 'maven'
  if (['kotlin', 'kt', 'kts'].includes(language))
    return 'kotlin'
  if (language === 'java')
    return 'java'
  if (language === 'bash')
    return 'terminal'
}
