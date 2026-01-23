export interface Repository {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  size: number
  default_branch: string
  pushed_at: string
  hasJfrog: boolean | null
  jfrogUrls: string[]
  configLocations: string[]
}

export interface ScanProgress {
  phase: 'idle' | 'fetching-repos' | 'checking-lfs' | 'complete' | 'partial' | 'error'
  totalRepos: number
  fetchedRepos: number
  checkedRepos: number
  jfrogReposFound: number
  currentRepo: string
  error: string | null
  rateLimitRemaining: number
  rateLimitReset: Date | null
}

export interface GitHubRateLimit {
  remaining: number
  limit: number
  reset: Date
}

export class RateLimitError extends Error {
  resetTime: Date
  constructor(resetTime: Date) {
    super(`Rate limit exceeded. Resets at ${resetTime.toLocaleTimeString()}`)
    this.name = 'RateLimitError'
    this.resetTime = resetTime
  }
}

export class NetworkError extends Error {
  statusCode?: number
  retryable: boolean
  constructor(message: string, statusCode?: number, retryable = true) {
    super(message)
    this.name = 'NetworkError'
    this.statusCode = statusCode
    this.retryable = retryable
  }
}

interface GitTreeItem {
  path: string
  type: string
  sha: string
}

interface TokenManager {
  getToken: () => string | null
  rotateToken: () => void
  getTokenCount: () => number
  getTriedTokensThisRequest: () => Set<string>
  resetTriedTokens: () => void
}

export interface ScanState {
  orgName: string
  createdAt: string
  allRepos: Repository[]
  scannedRepoIds: number[]
  pendingRepoIds: number[]
  jfrogRepos: Repository[]
  lastError?: string
  isComplete: boolean
  ghesHost?: string
}

export function normalizeGhesHost(ghesHost?: string): string | undefined {
  if (!ghesHost || ghesHost.trim() === '' || ghesHost.trim().toLowerCase() === 'github.com') {
    return undefined
  }
  return ghesHost.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()
}

export function getApiBaseUrl(ghesHost?: string): string {
  const normalizedHost = normalizeGhesHost(ghesHost)
  if (!normalizedHost) {
    return 'https://api.github.com'
  }
  return `https://${normalizedHost}/api/v3`
}

export function getWebBaseUrl(ghesHost?: string): string {
  const normalizedHost = normalizeGhesHost(ghesHost)
  if (!normalizedHost) {
    return 'https://github.com'
  }
  return `https://${normalizedHost}`
}

const MAX_RETRIES = 5
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000]

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class ServerError extends Error {
  statusCode: number
  constructor(statusCode: number) {
    super(`Server error: ${statusCode}`)
    this.name = 'ServerError'
    this.statusCode = statusCode
  }
}

async function fetchWithRetry(
  url: string,
  headers: HeadersInit,
  retries = MAX_RETRIES,
  onRetry?: (attempt: number, maxRetries: number, error: string) => void
): Promise<Response> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      
      const response = await fetch(url, { 
        headers,
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (response.status >= 500) {
        const errorMsg = `Server error ${response.status}`
        lastError = new ServerError(response.status)
        if (attempt < retries - 1) {
          const delay = RETRY_DELAYS[attempt] || 15000
          onRetry?.(attempt + 1, retries, `${errorMsg}, retrying in ${delay / 1000}s...`)
          await sleep(delay)
          continue
        }
      }
      
      return response
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new NetworkError('Request timeout', undefined, true)
      } else if (error instanceof TypeError && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
        lastError = new NetworkError(
          `Network error - this may be a CORS issue if connecting to a GHES instance. Ensure the server allows cross-origin requests from this domain.`,
          undefined,
          false
        )
        throw lastError
      } else {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
      
      if (attempt < retries - 1 && !(lastError instanceof NetworkError && !lastError.retryable)) {
        const delay = RETRY_DELAYS[attempt] || 15000
        onRetry?.(attempt + 1, retries, `${lastError.message}, retrying in ${delay / 1000}s...`)
        await sleep(delay)
      }
    }
  }
  
  throw new NetworkError(
    `Request failed after ${retries} attempts: ${lastError?.message || 'Unknown error'}`,
    lastError instanceof ServerError ? lastError.statusCode : undefined,
    true
  )
}

async function fetchWithTokenRotation(
  url: string,
  headers: HeadersInit,
  tokenManager: TokenManager,
  onRateLimit: (limit: GitHubRateLimit) => void,
  onRetry?: (attempt: number, maxRetries: number, error: string) => void
): Promise<Response> {
  const triedTokens = tokenManager.getTriedTokensThisRequest()
  
  while (true) {
    const token = tokenManager.getToken()
    const requestHeaders: HeadersInit = { ...headers }
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`
    }

    const response = await fetchWithRetry(url, requestHeaders, MAX_RETRIES, onRetry)
    
    const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '0')
    const limit = parseInt(response.headers.get('x-ratelimit-limit') || '60')
    const reset = new Date(parseInt(response.headers.get('x-ratelimit-reset') || '0') * 1000)
    onRateLimit({ remaining, limit, reset })

    if (response.status === 403 && remaining === 0) {
      if (token) {
        triedTokens.add(token)
      }
      
      const tokenCount = tokenManager.getTokenCount()
      if (tokenCount > 1 && triedTokens.size < tokenCount) {
        tokenManager.rotateToken()
        continue
      }
      
      throw new RateLimitError(reset)
    }

    tokenManager.resetTriedTokens()
    return response
  }
}

export async function fetchOrgRepos(
  org: string,
  getToken: () => string | null,
  onProgress: (repos: Repository[], page: number) => void,
  onRateLimit: (limit: GitHubRateLimit) => void,
  rotateToken?: () => void,
  getTokenCount?: () => number,
  existingRepos?: Repository[],
  onRetry?: (attempt: number, maxRetries: number, error: string) => void,
  ghesHost?: string
): Promise<Repository[]> {
  if (existingRepos && existingRepos.length > 0) {
    onProgress(existingRepos, 0)
    return existingRepos
  }

  const apiBaseUrl = getApiBaseUrl(ghesHost)
  const webBaseUrl = getWebBaseUrl(ghesHost)
  const allRepos: Repository[] = []
  let page = 1
  const perPage = 100
  let hasMore = true

  const triedTokens = new Set<string>()
  const tokenManager: TokenManager = {
    getToken,
    rotateToken: rotateToken || (() => {}),
    getTokenCount: getTokenCount || (() => 1),
    getTriedTokensThisRequest: () => triedTokens,
    resetTriedTokens: () => triedTokens.clear()
  }

  while (hasMore) {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github+json',
    }

    const response = await fetchWithTokenRotation(
      `${apiBaseUrl}/orgs/${org}/repos?per_page=${perPage}&page=${page}&sort=pushed`,
      headers,
      tokenManager,
      onRateLimit,
      onRetry
    )

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Organization "${org}" not found`)
      }
      throw new NetworkError(`GitHub API error: ${response.status}`, response.status)
    }

    const repos: any[] = await response.json()
    
    if (repos.length === 0) {
      hasMore = false
    } else {
      const mappedRepos: Repository[] = repos.map(r => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        html_url: r.html_url || `${webBaseUrl}/${r.full_name}`,
        description: r.description,
        size: r.size,
        default_branch: r.default_branch,
        pushed_at: r.pushed_at,
        hasJfrog: null,
        jfrogUrls: [],
        configLocations: []
      }))
      
      allRepos.push(...mappedRepos)
      onProgress(allRepos, page)
      
      if (repos.length < perPage) {
        hasMore = false
      } else {
        page++
      }
    }
  }

  return allRepos
}

export async function checkRepoForJfrog(
  repo: Repository,
  getToken: () => string | null,
  onRateLimit: (limit: GitHubRateLimit) => void,
  rotateToken?: () => void,
  getTokenCount?: () => number,
  onRetry?: (attempt: number, maxRetries: number, error: string) => void,
  ghesHost?: string
): Promise<Repository> {
  const apiBaseUrl = getApiBaseUrl(ghesHost)
  const triedTokens = new Set<string>()
  const tokenManager: TokenManager = {
    getToken,
    rotateToken: rotateToken || (() => {}),
    getTokenCount: getTokenCount || (() => 1),
    getTriedTokensThisRequest: () => triedTokens,
    resetTriedTokens: () => triedTokens.clear()
  }

  const headers: HeadersInit = {
    'Accept': 'application/vnd.github+json',
  }

  const treeResponse = await fetchWithTokenRotation(
    `${apiBaseUrl}/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
    headers,
    tokenManager,
    onRateLimit,
    onRetry
  )

  if (!treeResponse.ok) {
    return { ...repo, hasJfrog: false, jfrogUrls: [], configLocations: [] }
  }

  const treeData = await treeResponse.json()
  const lfsConfigFiles: GitTreeItem[] = (treeData.tree || []).filter(
    (item: GitTreeItem) => item.type === 'blob' && item.path.endsWith('.lfsconfig')
  )

  if (lfsConfigFiles.length === 0) {
    return { ...repo, hasJfrog: false, jfrogUrls: [], configLocations: [] }
  }

  const jfrogUrls: string[] = []
  const configLocations: string[] = []

  for (const file of lfsConfigFiles) {
    const contentHeaders: HeadersInit = {
      'Accept': 'application/vnd.github.raw',
    }

    const contentResponse = await fetchWithTokenRotation(
      `${apiBaseUrl}/repos/${repo.full_name}/contents/${encodeURIComponent(file.path)}?ref=${repo.default_branch}`,
      contentHeaders,
      tokenManager,
      onRateLimit,
      onRetry
    )

    if (!contentResponse.ok) continue

    const content = await contentResponse.text()
    
    if (content.toLowerCase().includes('jfrog')) {
      const lines = content.split('\n')
      for (const line of lines) {
        if (line.toLowerCase().includes('jfrog') && !jfrogUrls.includes(line.trim())) {
          jfrogUrls.push(line.trim())
          if (!configLocations.includes(file.path)) {
            configLocations.push(file.path)
          }
        }
      }
    }
  }

  return {
    ...repo,
    hasJfrog: jfrogUrls.length > 0,
    jfrogUrls,
    configLocations
  }
}

export interface ScanResult {
  repos: Repository[]
  isPartial: boolean
  rateLimitReset?: Date
  errorMessage?: string
  scanState: ScanState
  wasPaused?: boolean
}

export async function checkAllReposForJfrog(
  repos: Repository[],
  getToken: () => string | null,
  onProgress: (checked: number, current: string, jfrogFound: number) => void,
  onRateLimit: (limit: GitHubRateLimit) => void,
  rotateToken?: () => void,
  getTokenCount?: () => number,
  existingScanState?: ScanState,
  onRetry?: (attempt: number, maxRetries: number, error: string) => void,
  shouldCancel?: () => boolean,
  ghesHost?: string
): Promise<ScanResult> {
  const orgName = repos[0]?.full_name.split('/')[0] || 'unknown'
  
  const scanState: ScanState = existingScanState || {
    orgName,
    createdAt: new Date().toISOString(),
    allRepos: repos,
    scannedRepoIds: [],
    pendingRepoIds: repos.map(r => r.id),
    jfrogRepos: [],
    isComplete: false,
    ghesHost
  }

  const pendingRepos = repos.filter(r => scanState.pendingRepoIds.includes(r.id))
  const alreadyScanned = scanState.scannedRepoIds.length
  
  const results: Repository[] = [...scanState.jfrogRepos]
  let jfrogCount = results.filter(r => r.hasJfrog).length
  const token = getToken()
  const concurrency = token ? 5 : 2

  for (let i = 0; i < pendingRepos.length; i += concurrency) {
    if (shouldCancel?.()) {
      return {
        repos: results,
        isPartial: true,
        wasPaused: true,
        errorMessage: `Scan paused by user. ${scanState.scannedRepoIds.length} repos scanned, ${scanState.pendingRepoIds.length} remaining.`,
        scanState
      }
    }

    const batch = pendingRepos.slice(i, i + concurrency)
    
    try {
      const batchResults = await Promise.all(
        batch.map(repo => checkRepoForJfrog(repo, getToken, onRateLimit, rotateToken, getTokenCount, onRetry, ghesHost || scanState.ghesHost))
      )
      
      for (const result of batchResults) {
        scanState.scannedRepoIds.push(result.id)
        scanState.pendingRepoIds = scanState.pendingRepoIds.filter(id => id !== result.id)
        
        if (result.hasJfrog) {
          results.push(result)
          scanState.jfrogRepos.push(result)
          jfrogCount++
        }
      }
      
      onProgress(alreadyScanned + i + batchResults.length, batch[batch.length - 1]?.name || '', jfrogCount)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      scanState.lastError = errorMessage
      
      if (error instanceof RateLimitError) {
        return {
          repos: results,
          isPartial: true,
          rateLimitReset: error.resetTime,
          errorMessage: `Rate limit exceeded. Resets at ${error.resetTime.toLocaleTimeString()}`,
          scanState
        }
      }
      
      if (error instanceof NetworkError || error instanceof ServerError) {
        return {
          repos: results,
          isPartial: true,
          errorMessage: `Network error: ${errorMessage}. ${scanState.scannedRepoIds.length} repos scanned, ${scanState.pendingRepoIds.length} remaining.`,
          scanState
        }
      }
      
      return {
        repos: results,
        isPartial: true,
        errorMessage,
        scanState
      }
    }
    
    if (i + concurrency < pendingRepos.length) {
      await sleep(token ? 100 : 500)
    }
  }

  scanState.isComplete = true
  scanState.pendingRepoIds = []
  
  return {
    repos: results,
    isPartial: false,
    scanState
  }
}

export function generateCsv(repos: Repository[]): string {
  const jfrogRepos = repos.filter(r => r.hasJfrog)
  const headers = ['Repository', 'URL', 'Description', 'Size (KB)', 'Last Pushed', 'Config Locations', 'JFrog URLs']
  const rows = jfrogRepos.map(r => [
    r.full_name,
    r.html_url,
    `"${(r.description || '').replace(/"/g, '""')}"`,
    r.size.toString(),
    r.pushed_at,
    `"${r.configLocations.join('; ').replace(/"/g, '""')}"`,
    `"${r.jfrogUrls.join('; ').replace(/"/g, '""')}"`
  ])
  
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function downloadScanState(scanState: ScanState): void {
  const content = JSON.stringify(scanState, null, 2)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${scanState.orgName}-scan-state-${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function parseScanState(content: string): ScanState | null {
  try {
    const state = JSON.parse(content) as ScanState
    if (
      typeof state.orgName === 'string' &&
      Array.isArray(state.allRepos) &&
      Array.isArray(state.scannedRepoIds) &&
      Array.isArray(state.pendingRepoIds) &&
      Array.isArray(state.jfrogRepos)
    ) {
      return state
    }
    return null
  } catch {
    return null
  }
}

export interface TokenRateLimit {
  token: string
  remaining: number
  limit: number
  reset: Date
  userId?: number
  username?: string
}

export interface AggregateRateLimit {
  const apiBaseUrl = getApiBaseUrl(ghesHost)
  tokenLimits: TokenRateLimit[]
  uniqueUsers: number
  errors?: string[]
}

export async function fetchTokenRateLimits(tokens: string[], ghesHost?: string): Promise<AggregateRateLimit> {
  const apiBaseUrl = getApiBaseUrl(ghesHost)
  const tokenLimits: TokenRateLimit[] = []
  const errors: string[] = []
  
  for (const token of tokens) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      
      const [rateLimitResponse, userResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/rate_limit`, {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`
        const rateLimitData = await rateLimitResponse.json()
        
        let remaining: number
        let limit: number
        let resetTimestamp: number
            'Accept': 'application/vnd.github+json',
        if (rateLimitData?.resources?.core) {
          remaining = rateLimitData.resources.core.remaining
          limit = rateLimitData.resources.core.limit
          resetTimestamp = rateLimitData.resources.core.reset
        } else if (rateLimitData?.rate) {
          remaining = rateLimitData.rate.remaining
          limit = rateLimitData.rate.limit
          resetTimestamp = rateLimitData.rate.reset
        } else {
          remaining = parseInt(rateLimitResponse.headers.get('x-ratelimit-remaining') || '0')
          limit = parseInt(rateLimitResponse.headers.get('x-ratelimit-limit') || '5000')
          resetTimestamp = parseInt(rateLimitResponse.headers.get('x-ratelimit-reset') || '0')
        }
        
        const reset = new Date(resetTimestamp * 1000)
        
          remaining = rateLimitData.resources.core.remaining
          limit = rateLimitData.resources.core.limit
          resetTimestamp = rateLimitData.resources.core.reset
        } else if (rateLimitData?.rate) {
          remaining = rateLimitData.rate.remaining
          limit = rateLimitData.rate.limit
          resetTimestamp = rateLimitData.rate.reset
        } else {
          remaining = parseInt(rateLimitResponse.headers.get('x-ratelimit-remaining') || '0')
          limit = parseInt(rateLimitResponse.headers.get('x-ratelimit-limit') || '5000')
          resetTimestamp = parseInt(rateLimitResponse.headers.get('x-ratelimit-reset') || '0')
        }
        
        const reset = new Date(resetTimestamp * 1000)
        
        let userId: number | undefined
        let username: string | undefined
      } else {
        const headerRemaining = rateLimitResponse.headers.get('x-ratelimit-remaining')
        const headerLimit = rateLimitResponse.headers.get('x-ratelimit-limit')
        const headerReset = rateLimitResponse.headers.get('x-ratelimit-reset')
        
        if (headerRemaining && headerLimit) {
          let userId: number | undefined
          let username: string | undefined
          
          if (userResponse.ok) {
            const userData = await userResponse.json()
            userId = userData.id
            username = userData.login
          }
          
          tokenLimits.push({
            token,
            remaining: parseInt(headerRemaining),
            limit: parseInt(headerLimit),
            reset: new Date(parseInt(headerReset || '0') * 1000),
            userId,
            username
          })
        }
          if (userResponse.ok) {
    } catch (e) {wait userResponse.json()
      console.error('Error fetching rate limit for token:', e)
            username = userData.login
          }
          
          tokenLimits.push({
            token,
            remaining: parseInt(headerRemaining),
            limit: parseInt(headerLimit),
            reset: new Date(parseInt(headerReset || '0') * 1000),
            userId,
            username
          })
        } else {
          errors.push(`Token ${token.slice(0, 8)}...: HTTP ${rateLimitResponse.status}`)
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('AbortError')) {
        errors.push(`Token ${token.slice(0, 8)}...: Network error (CORS or connectivity issue)`)
      } else {
        errors.push(`Token ${token.slice(0, 8)}...: ${errorMsg}`)
      }
    }
  }
    uniqueUsers: seenUserIds.size || tokenLimits.length
  const seenUserIds = new Set<number>()
  let totalRemaining = 0
  let totalLimit = 0
  
  for (const tokenLimit of tokenLimits) {
    if (tokenLimit.userId !== undefined) {
      if (!seenUserIds.has(tokenLimit.userId)) {
        seenUserIds.add(tokenLimit.userId)
        totalRemaining += tokenLimit.remaining
        totalLimit += tokenLimit.limit
      }
    } else {
      totalRemaining += tokenLimit.remaining
      totalLimit += tokenLimit.limit
    }
  }
  
  return {
    totalRemaining,
    totalLimit,
    tokenLimits,
    uniqueUsers: seenUserIds.size || tokenLimits.length,
    errors: errors.length > 0 ? errors : undefined
  } as AggregateRateLimit
}
