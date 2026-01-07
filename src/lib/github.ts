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
  phase: 'idle' | 'fetching-repos' | 'checking-lfs' | 'complete' | 'error'
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

interface GitTreeItem {
  path: string
  type: string
  sha: string
}

export async function fetchOrgRepos(
  org: string,
  token: string | null,
  onProgress: (repos: Repository[], page: number) => void,
  onRateLimit: (limit: GitHubRateLimit) => void
): Promise<Repository[]> {
  const allRepos: Repository[] = []
  let page = 1
  const perPage = 100
  let hasMore = true

  while (hasMore) {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github+json',
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(
      `https://api.github.com/orgs/${org}/repos?per_page=${perPage}&page=${page}&sort=pushed`,
      { headers }
    )

    const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '0')
    const limit = parseInt(response.headers.get('x-ratelimit-limit') || '60')
    const reset = new Date(parseInt(response.headers.get('x-ratelimit-reset') || '0') * 1000)
    onRateLimit({ remaining, limit, reset })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Organization "${org}" not found`)
      }
      if (response.status === 403 && remaining === 0) {
        throw new Error(`Rate limit exceeded. Resets at ${reset.toLocaleTimeString()}`)
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

    if (remaining < 10) {
      const waitTime = Math.max(0, reset.getTime() - Date.now())
      if (waitTime > 0 && waitTime < 60000) {
        await new Promise(resolve => setTimeout(resolve, waitTime + 1000))
      }
    }
  }

  return allRepos
}

export async function checkRepoForJfrog(
  repo: Repository,
  token: string | null,
  onRateLimit: (limit: GitHubRateLimit) => void
): Promise<Repository> {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github+json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const treeResponse = await fetch(
      `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
      { headers }
    )

    const remaining = parseInt(treeResponse.headers.get('x-ratelimit-remaining') || '0')
    const limit = parseInt(treeResponse.headers.get('x-ratelimit-limit') || '60')
    const reset = new Date(parseInt(treeResponse.headers.get('x-ratelimit-reset') || '0') * 1000)
    onRateLimit({ remaining, limit, reset })

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
      if (token) {
        contentHeaders['Authorization'] = `Bearer ${token}`
      }

      const contentResponse = await fetch(
        `https://api.github.com/repos/${repo.full_name}/contents/${encodeURIComponent(file.path)}?ref=${repo.default_branch}`,
        { headers: contentHeaders }
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
  } catch {
    return { ...repo, hasJfrog: false, jfrogUrls: [], configLocations: [] }
  }
}

export async function checkAllReposForJfrog(
  repos: Repository[],
  token: string | null,
  onProgress: (checked: number, current: string, jfrogFound: number) => void,
  onRateLimit: (limit: GitHubRateLimit) => void
): Promise<Repository[]> {
  const results: Repository[] = []
  let jfrogCount = 0
  const concurrency = token ? 5 : 2

  for (let i = 0; i < repos.length; i += concurrency) {
    const batch = repos.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(repo => checkRepoForJfrog(repo, token, onRateLimit))
    )
    
    for (const result of batchResults) {
      results.push(result)
      if (result.hasJfrog) jfrogCount++
    }
    
    onProgress(results.length, batch[batch.length - 1]?.name || '', jfrogCount)
    
    if (i + concurrency < repos.length) {
      await new Promise(resolve => setTimeout(resolve, token ? 100 : 500))
    }
  }

  return results
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
