import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectShells, buildCleanEnv, SENSITIVE_ENV_PATTERN } from '../lib/shell.js'

describe('shell detection and environment', () => {
  it('detects at least one default shell on the host platform', () => {
    const res = detectShells()
    assert.ok(res.defaultShell, 'must have defaultShell')
    assert.ok(res.defaultShell.path, 'defaultShell must have executable path')
    assert.ok(Array.isArray(res.available), 'available must be an array')
    assert.ok(res.available.length > 0, 'available must contain at least 1 shell')
  })

  it('filters sensitive credentials and retains standard env', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-secret-test'
    process.env.OPENAI_API_KEY = 'sk-secret-test2'
    process.env.MY_SECRET_TOKEN = 'secret-token'
    process.env.NORMAL_VAR = 'normal_value'

    const clean = buildCleanEnv({ CUSTOM_TERM_VAR: '1' })
    assert.equal(clean.DEEPSEEK_API_KEY, undefined)
    assert.equal(clean.OPENAI_API_KEY, undefined)
    assert.equal(clean.MY_SECRET_TOKEN, undefined)
    assert.equal(clean.NORMAL_VAR, 'normal_value')
    assert.equal(clean.TERM, 'xterm-256color')
    assert.equal(clean.COLORTERM, 'truecolor')
    assert.equal(clean.CUSTOM_TERM_VAR, '1')
  })

  it('identifies sensitive keys using regex pattern', () => {
    assert.ok(SENSITIVE_ENV_PATTERN.test('DEEPSEEK_API_KEY'))
    assert.ok(SENSITIVE_ENV_PATTERN.test('OPENAI_KEY'))
    assert.ok(SENSITIVE_ENV_PATTERN.test('DSH_SESSION_ID'))
    assert.ok(SENSITIVE_ENV_PATTERN.test('API_KEY_AUTH'))
    assert.ok(!SENSITIVE_ENV_PATTERN.test('PATH'))
    assert.ok(!SENSITIVE_ENV_PATTERN.test('USERPROFILE'))
    assert.ok(!SENSITIVE_ENV_PATTERN.test('HOME'))
  })
})
