import { describe, expect, it } from 'vitest'

import { classifyConnectionError, testPanelConnection } from '../src/connection-test.js'
import { relayFromPanel, type PanelConfig } from '../src/panels.js'
import { Relay, RelayAuthError } from '../src/relay.js'
import { startMockRelay } from './mock-relay.js'

const PANEL: PanelConfig = {
  id: 'my-relay', baseUrl: '', relayKind: 'new-api',
  accessToken: 'test-access-token/abc=', userId: 42, keyRef: 'RELAY_API_KEY_MY_RELAY', selectedKeyName: '',
}

describe('classifyConnectionError (the four user-facing shapes)', () => {
  it('HTTP 401 + New-Api-User mismatch wording → user-mismatch', () => {
    const err = new RelayAuthError('中转站鉴权失败（401）: 无权进行此操作，New-Api-User 与登录用户不匹配')
    err.status = 401
    err.detail = '无权进行此操作，New-Api-User 与登录用户不匹配'
    expect(classifyConnectionError(err)).toMatchObject({ ok: false, reason: 'user-mismatch' })
  })

  it('HTTP 401 anything else → token-invalid', () => {
    const err = new RelayAuthError('中转站鉴权失败（401）: 无权进行此操作，token 无效')
    err.status = 401
    err.detail = '无权进行此操作，token 无效'
    expect(classifyConnectionError(err)).toMatchObject({ ok: false, reason: 'token-invalid' })
    expect(classifyConnectionError(err).error).toContain('token 无效')
  })

  it('transport failure (no status) → unreachable', () => {
    expect(classifyConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:1')))
      .toMatchObject({ ok: false, reason: 'unreachable' })
    expect(classifyConnectionError(new Error('timeout after 20000ms')))
      .toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('other HTTP statuses → error with the panel detail', () => {
    const err = Object.assign(new Error('HTTP 500 from panel: boom'), { status: 500, detail: 'boom' })
    expect(classifyConnectionError(err)).toMatchObject({ ok: false, reason: 'error' })
  })
})

describe('testPanelConnection against the mock panel', () => {
  it('success returns the account line without any token material', async () => {
    const mock = await startMockRelay()
    try {
      const result = await testPanelConnection({ ...PANEL, baseUrl: mock.baseUrl })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.account.username).toBe('tester')
        expect(result.account.quotaCny).toBe('0.5000')
      }
      expect(JSON.stringify(result)).not.toContain('sk-')
      expect(JSON.stringify(result)).not.toContain(PANEL.accessToken!)
    } finally {
      await mock.close()
    }
  })

  it('a wrong user id classifies as user-mismatch', async () => {
    const mock = await startMockRelay()
    try {
      const result = await testPanelConnection({ ...PANEL, baseUrl: mock.baseUrl, userId: 99 })
      expect(result).toMatchObject({ ok: false, reason: 'user-mismatch' })
    } finally {
      await mock.close()
    }
  })

  it('a wrong token classifies as token-invalid', async () => {
    const mock = await startMockRelay()
    try {
      const result = await testPanelConnection({ ...PANEL, baseUrl: mock.baseUrl, accessToken: 'wrong-token' })
      expect(result).toMatchObject({ ok: false, reason: 'token-invalid' })
    } finally {
      await mock.close()
    }
  })

  it('a dead port classifies as unreachable', async () => {
    const result = await testPanelConnection({ ...PANEL, baseUrl: 'http://127.0.0.1:9', timeoutMs: 500 } as PanelConfig, relayFromPanel({ ...PANEL, baseUrl: 'http://127.0.0.1:9' }, 500))
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' })
  })
})

describe('Relay auth errors carry the classification payload', () => {
  it('managementSend surfaces status + detail on RelayAuthError', async () => {
    const mock = await startMockRelay()
    try {
      const relay = new Relay({ baseUrl: mock.baseUrl, accessToken: 'bad', userId: 42 })
      const err = await relay.self().then(() => null, (e: unknown) => e as RelayAuthError)
      expect(err).toBeInstanceOf(RelayAuthError)
      expect(err!.status).toBe(401)
      expect(err!.detail).toContain('token')
    } finally {
      await mock.close()
    }
  })
})
