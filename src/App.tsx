import { useState, useCallback } from 'react'
import { useKV } from '@github/spark/hooks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  MagnifyingGlass, 
  Download, 
  CheckCircle, 
  Warning, 
  GithubLogo,
  Eye,
  EyeSlash,
  Plus,
  X,
  Database,
  Clock,
  ArrowRight
} from '@phosphor-icons/react'
import {
  Repository,
  ScanProgress,
  GitHubRateLimit,
  fetchOrgRepos,
  checkAllReposForLfs,
  generateCsv,
  downloadCsv
} from '@/lib/github'

function App() {
  const [orgName, setOrgName] = useState('')
  const [storedTokens, setStoredTokens] = useKV<string[]>('github-tokens', [])
  const tokens = storedTokens ?? []
  const [newToken, setNewToken] = useState('')
  const [showTokens, setShowTokens] = useState(false)
  const [repos, setRepos] = useState<Repository[]>([])
  const [progress, setProgress] = useState<ScanProgress>({
    phase: 'idle',
    totalRepos: 0,
    fetchedRepos: 0,
    checkedRepos: 0,
    lfsReposFound: 0,
    currentRepo: '',
    error: null,
    rateLimitRemaining: 60,
    rateLimitReset: null
  })
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(null)
  const [currentTokenIndex, setCurrentTokenIndex] = useState(0)

  const getCurrentToken = useCallback(() => {
    if (tokens.length === 0) return null
    return tokens[currentTokenIndex % tokens.length]
  }, [tokens, currentTokenIndex])

  const rotateToken = useCallback(() => {
    if (tokens.length > 1) {
      setCurrentTokenIndex(prev => (prev + 1) % tokens.length)
    }
  }, [tokens.length])

  const handleAddToken = () => {
    if (newToken.trim() && !tokens.includes(newToken.trim())) {
      setStoredTokens(current => [...(current ?? []), newToken.trim()])
      setNewToken('')
    }
  }

  const handleRemoveToken = (index: number) => {
    setStoredTokens(current => (current ?? []).filter((_, i) => i !== index))
  }

  const handleRateLimit = useCallback((limit: GitHubRateLimit) => {
    setRateLimit(limit)
    setProgress(prev => ({
      ...prev,
      rateLimitRemaining: limit.remaining,
      rateLimitReset: limit.reset
    }))

    if (limit.remaining < 50 && tokens.length > 1) {
      rotateToken()
    }
  }, [tokens.length, rotateToken])

  const handleScan = async () => {
    if (!orgName.trim()) return

    setRepos([])
    setProgress({
      phase: 'fetching-repos',
      totalRepos: 0,
      fetchedRepos: 0,
      checkedRepos: 0,
      lfsReposFound: 0,
      currentRepo: '',
      error: null,
      rateLimitRemaining: rateLimit?.remaining || 60,
      rateLimitReset: rateLimit?.reset || null
    })

    try {
      const allRepos = await fetchOrgRepos(
        orgName.trim(),
        getCurrentToken(),
        (fetchedRepos, page) => {
          setProgress(prev => ({
            ...prev,
            fetchedRepos: fetchedRepos.length,
            totalRepos: fetchedRepos.length,
            currentRepo: `Page ${page}`
          }))
        },
        handleRateLimit
      )

      setProgress(prev => ({
        ...prev,
        phase: 'checking-lfs',
        totalRepos: allRepos.length,
        fetchedRepos: allRepos.length
      }))

      const checkedRepos = await checkAllReposForLfs(
        allRepos,
        getCurrentToken(),
        (checked, current, lfsFound) => {
          setProgress(prev => ({
            ...prev,
            checkedRepos: checked,
            currentRepo: current,
            lfsReposFound: lfsFound
          }))
        },
        handleRateLimit
      )

      setRepos(checkedRepos)
      setProgress(prev => ({
        ...prev,
        phase: 'complete',
        checkedRepos: checkedRepos.length,
        lfsReposFound: checkedRepos.filter(r => r.hasLfs).length
      }))
    } catch (error) {
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }

  const handleExport = () => {
    const csv = generateCsv(repos)
    downloadCsv(csv, `${orgName}-lfs-repos-${new Date().toISOString().split('T')[0]}.csv`)
  }

  const lfsRepos = repos.filter(r => r.hasLfs)
  const isScanning = progress.phase === 'fetching-repos' || progress.phase === 'checking-lfs'
  const scanProgress = progress.totalRepos > 0 
    ? Math.round((progress.checkedRepos / progress.totalRepos) * 100)
    : 0

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-primary/10 rounded-lg">
            <GithubLogo size={32} weight="fill" className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">LFS Repository Finder</h1>
            <p className="text-muted-foreground text-sm">Scan large GitHub organizations for Git LFS usage</p>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MagnifyingGlass size={18} />
                Organization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  id="org-name"
                  placeholder="e.g. microsoft, google, facebook"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isScanning && handleScan()}
                  disabled={isScanning}
                  className="bg-input border-border font-mono"
                />
                <Button 
                  onClick={handleScan} 
                  disabled={!orgName.trim() || isScanning}
                  className="shrink-0"
                >
                  {isScanning ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">⟳</span>
                      Scanning
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Scan
                      <ArrowRight size={16} />
                    </span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Database size={18} />
                  PAT Tokens (Optional)
                </span>
                <Badge variant="secondary" className="font-mono text-xs">
                  {tokens.length} token{tokens.length !== 1 ? 's' : ''}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Add PAT tokens to increase rate limits (5000 req/hr vs 60). Multiple tokens enable rotation.
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="new-token"
                    type={showTokens ? 'text' : 'password'}
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddToken()}
                    className="bg-input border-border font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTokens(!showTokens)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showTokens ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Button variant="secondary" size="icon" onClick={handleAddToken} disabled={!newToken.trim()}>
                  <Plus size={16} />
                </Button>
              </div>
              {tokens.length > 0 && (
                <div className="space-y-1">
                  {tokens.map((token, i) => (
                    <div key={i} className="flex items-center justify-between bg-secondary/50 rounded px-3 py-1.5 text-xs">
                      <span className="font-mono text-muted-foreground">
                        {token.slice(0, 8)}...{token.slice(-4)}
                        {i === currentTokenIndex && isScanning && (
                          <Badge variant="outline" className="ml-2 text-[10px]">active</Badge>
                        )}
                      </span>
                      <button
                        onClick={() => handleRemoveToken(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {progress.phase !== 'idle' && (
          <Card className="bg-card border-border">
            <CardContent className="py-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {progress.phase === 'error' ? (
                      <Warning size={18} className="text-destructive" />
                    ) : progress.phase === 'complete' ? (
                      <CheckCircle size={18} className="text-accent" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                    <span className="font-medium">
                      {progress.phase === 'fetching-repos' && 'Fetching repositories...'}
                      {progress.phase === 'checking-lfs' && `Checking for LFS: ${progress.currentRepo}`}
                      {progress.phase === 'complete' && 'Scan complete'}
                      {progress.phase === 'error' && 'Scan failed'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {rateLimit && (
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {rateLimit.remaining}/{rateLimit.limit} requests
                      </span>
                    )}
                    {progress.phase === 'checking-lfs' && (
                      <span>{progress.checkedRepos}/{progress.totalRepos} repos</span>
                    )}
                  </div>
                </div>
                
                {(progress.phase === 'fetching-repos' || progress.phase === 'checking-lfs') && (
                  <div className="relative overflow-hidden rounded-full bg-secondary h-2">
                    <div 
                      className="h-full bg-primary transition-all duration-300 ease-out"
                      style={{ width: `${progress.phase === 'fetching-repos' ? 5 : scanProgress}%` }}
                    />
                    {progress.phase === 'fetching-repos' && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-scan" />
                    )}
                  </div>
                )}

                {progress.phase === 'error' && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>{progress.error}</AlertDescription>
                  </Alert>
                )}

                {progress.phase === 'complete' && (
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex gap-4 text-sm">
                      <span>
                        <span className="text-muted-foreground">Total repos:</span>{' '}
                        <span className="font-semibold">{progress.totalRepos}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">LFS repos:</span>{' '}
                        <span className="font-semibold text-accent">{progress.lfsReposFound}</span>
                      </span>
                    </div>
                    {lfsRepos.length > 0 && (
                      <Button onClick={handleExport} variant="secondary" size="sm">
                        <Download size={16} className="mr-2" />
                        Export CSV
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {progress.phase === 'complete' && lfsRepos.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle size={18} className="text-accent" />
                Repositories using LFS ({lfsRepos.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-2">
                  {lfsRepos.map(repo => (
                    <div 
                      key={repo.id}
                      className="p-3 bg-secondary/30 rounded-lg border border-border/50 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <a 
                            href={repo.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline"
                          >
                            {repo.full_name}
                          </a>
                          {repo.description && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {repo.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {repo.lfsPatterns.slice(0, 3).map((pattern, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono">
                                {pattern.length > 40 ? pattern.slice(0, 40) + '...' : pattern}
                              </Badge>
                            ))}
                            {repo.lfsPatterns.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{repo.lfsPatterns.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground shrink-0">
                          <div>{(repo.size / 1024).toFixed(1)} MB</div>
                          <div>{new Date(repo.pushed_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {progress.phase === 'complete' && lfsRepos.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary flex items-center justify-center">
                <Database size={32} className="text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No LFS repositories found</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Scanned {progress.totalRepos} repositories in <span className="font-mono">{orgName}</span> but none were using Git LFS.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default App
