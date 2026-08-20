/**
 * Cross-platform shell detection and environment preparation.
 * Supports Windows (PowerShell 7, Windows PowerShell, CMD, Git Bash), macOS (Zsh, Bash), Linux (Bash, Zsh).
 *
 * @module dsh-terminal/shell
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Heuristic pattern to strip sensitive secrets / credentials from child environment.
 */
export const SENSITIVE_ENV_PATTERN = /(DEEPSEEK|OPENAI|ANTHROPIC|API_KEY|TOKEN|SECRET|PASSWORD|DSH_SESSION_ID)/i

/**
 * Strip sensitive credentials from process.env and provide required terminal env variables.
 * @param {Record<string, string>} [extraEnv]
 * @returns {Record<string, string>}
 */
export function buildCleanEnv(extraEnv = {}) {
  const base = { ...process.env }
  for (const key of Object.keys(base)) {
    if (SENSITIVE_ENV_PATTERN.test(key)) {
      delete base[key]
    }
  }
  return {
    ...base,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...extraEnv,
  }
}

/**
 * Detect available shells on the current operating system.
 * @param {string} [platform] - Target platform override (for testing)
 * @param {Record<string, string>} [env] - Target env override (for testing)
 * @returns {{ defaultShell: { id: string, name: string, path: string, args: string[] }, available: Array<{ id: string, name: string, path: string, args: string[] }> }}
 */
export function detectShells(platform = process.platform, env = process.env) {
  const list = []

  if (platform === 'win32') {
    const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    const pwsh7Preview = 'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe'
    const winPs = join(env.SystemRoot || 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    const cmd = env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const gitBash64 = 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'

    if (existsSync(pwsh7)) {
      list.push({ id: 'pwsh', name: 'PowerShell 7', path: pwsh7, args: ['-NoLogo'] })
    } else if (existsSync(pwsh7Preview)) {
      list.push({ id: 'pwsh-preview', name: 'PowerShell 7 Preview', path: pwsh7Preview, args: ['-NoLogo'] })
    }

    if (existsSync(winPs)) {
      list.push({ id: 'powershell', name: 'Windows PowerShell', path: winPs, args: ['-NoLogo'] })
    }

    if (existsSync(cmd)) {
      list.push({ id: 'cmd', name: 'Command Prompt (CMD)', path: cmd, args: [] })
    }

    if (existsSync(gitBash)) {
      list.push({ id: 'git-bash', name: 'Git Bash', path: gitBash, args: ['-l'] })
    } else if (existsSync(gitBash64)) {
      list.push({ id: 'git-bash', name: 'Git Bash', path: gitBash64, args: ['-l'] })
    }

    const defaultShell = list[0] || { id: 'cmd', name: 'Command Prompt', path: cmd, args: [] }
    return { defaultShell, available: list.length > 0 ? list : [defaultShell] }
  }

  // macOS (darwin) & Linux
  const userShell = env.SHELL
  if (userShell && existsSync(userShell)) {
    const basename = userShell.split('/').pop() || 'shell'
    list.push({ id: basename, name: `${basename} (Default)`, path: userShell, args: ['-l'] })
  }

  const commonShells = platform === 'darwin'
    ? ['/bin/zsh', '/bin/bash', '/bin/sh']
    : ['/bin/bash', '/usr/bin/zsh', '/bin/sh', '/usr/bin/bash']

  for (const sh of commonShells) {
    if (existsSync(sh) && !list.some(item => item.path === sh)) {
      const id = sh.split('/').pop()
      list.push({ id, name: id, path: sh, args: ['-l'] })
    }
  }

  const defaultShell = list[0] || { id: 'sh', name: 'sh', path: '/bin/sh', args: [] }
  return { defaultShell, available: list.length > 0 ? list : [defaultShell] }
}
