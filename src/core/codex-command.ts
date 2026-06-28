import fs from 'node:fs'
import path from 'node:path'

const MACOS_CODEX_EXECUTABLE = '/Applications/Codex.app/Contents/Resources/codex'

function isExecutable(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveCodexExecutable(env: NodeJS.ProcessEnv = process.env) {
  const explicitPath = env.CODEX_SWITCH_CODEX_PATH?.trim()
  if (explicitPath && isExecutable(explicitPath)) {
    return explicitPath
  }

  const pathValue = env.PATH ?? ''
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue

    const candidate = path.join(directory, 'codex')
    if (isExecutable(candidate)) {
      return candidate
    }
  }

  if (process.platform === 'darwin' && isExecutable(MACOS_CODEX_EXECUTABLE)) {
    return MACOS_CODEX_EXECUTABLE
  }

  return 'codex'
}
