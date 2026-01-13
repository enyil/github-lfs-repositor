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

async function fetchWithTokenRotation(
  url: string,
  headers: HeadersInit,
  tokenManager: TokenManager,
  onRateLimit: (limit: GitHubRateLimit) => void
): Promise<Response> {
  const triedTokens = tokenManager.getTriedTokensThisRequest()
  
  while (true) {
    const token = tokenManager.getToken()
    const requestHeaders: HeadersInit = { ...headers }
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(url, { headers: requestHeaders })
    
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
  getTokenCount?: () => number
): Promise<Repository[]> {
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
      `https://api.github.com/orgs/${org}/repos?per_page=${perPage}&page=${page}&sort=pushed`,
      headers,
      tokenManager,
      onRateLimit
    )

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Organization "${org}" not found`)
      }
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const repos: any[] = await response.json()
    
    if (repos.length === 0) {
      hasMore = false
    } else {
      const mappedRepos: Repository[] = repos.map(r => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        html_url: r.html_url,
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
  getTokenCount?: () => number
): Promise<Repository> {
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
    `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
    headers,
    tokenManager,
    onRateLimit
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
      `https://api.github.com/repos/${repo.full_name}/contents/${encodeURIComponent(file.path)}?ref=${repo.default_branch}`,
      contentHeaders,
      tokenManager,
      onRateLimit
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
}

export async function checkAllReposForJfrog(
  repos: Repository[],
  getToken: () => string | null,
  onProgress: (checked: number, current: string, jfrogFound: number) => void,
  onRateLimit: (limit: GitHubRateLimit) => void,
  rotateToken?: () => void,
  getTokenCount?: () => number
): Promise<ScanResult> {
  const results: Repository[] = []
  let jfrogCount = 0
  const token = getToken()
  const concurrency = token ? 5 : 2

  for (let i = 0; i < repos.length; i += concurrency) {
    const batch = repos.slice(i, i + concurrency)
    
    try {
      const batchResults = await Promise.all(
        batch.map(repo => checkRepoForJfrog(repo, getToken, onRateLimit, rotateToken, getTokenCount))
      )
      
      for (const result of batchResults) {
        results.push(result)
        if (result.hasJfrog) jfrogCount++
      }
      
      onProgress(results.length, batch[batch.length - 1]?.name || '', jfrogCount)
    } catch (error) {
      if (error instanceof RateLimitError) {
        return {
          repos: results,
          isPartial: true,
          rateLimitReset: error.resetTime
        }
      }
      throw error
    }
    
    if (i + concurrency < repos.length) {
      await new Promise(resolve => setTimeout(resolve, token ? 100 : 500))
    }
  }

  return {
    repos: results,
    isPartial: false
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
