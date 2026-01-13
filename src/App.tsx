import { useState, useCallback, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  RateLimitError,
  fetchOrgRepos,
  checkAllReposForJfrog,
  generateCsv,
  downloadCsv
} from '@/lib/github'

function App() {
  const [orgName, setOrgName] = useState('')
  const [tokens, setTokens] = useState<string[]>([])
  const [newToken, setNewToken] = useState('')
  const [showTokens, setShowTokens] = useState(false)
  const [repos, setRepos] = useState<Repository[]>([])
  const [progress, setProgress] = useState<ScanProgress>({
    phase: 'idle',
    totalRepos: 0,
    fetchedRepos: 0,
    checkedRepos: 0,
    jfrogReposFound: 0,
    currentRepo: '',
    error: null,
    rateLimitRemaining: 60,
    rateLimitReset: null
  })
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(null)
  const [currentTokenIndex, setCurrentTokenIndex] = useState(0)
  const tokenIndexRef = useRef(0)
  const tokensRef = useRef<string[]>([])

  tokensRef.current = tokens

  const getCurrentToken = useCallback(() => {
    if (tokensRef.current.length === 0) return null
    return tokensRef.current[tokenIndexRef.current % tokensRef.current.length]
  }, [])

  const rotateToken = useCallback(() => {
    if (tokensRef.current.length > 1) {
      tokenIndexRef.current = (tokenIndexRef.current + 1) % tokensRef.current.length
      setCurrentTokenIndex(tokenIndexRef.current)
    }
  }, [])

  const handleAddToken = () => {
    if (newToken.trim() && !tokens.includes(newToken.trim())) {
      setTokens(current => [...current, newToken.trim()])
      setNewToken('')
    }
  }

  const handleRemoveToken = (index: number) => {
    setTokens(current => current.filter((_, i) => i !== index))
  }

  const handleRateLimit = useCallback((limit: GitHubRateLimit) => {
    setRateLimit(limit)
    setProgress(prev => ({
      ...prev,
      rateLimitRemaining: limit.remaining,
      rateLimitReset: limit.reset
    }))

    if (limit.remaining < 50 && tokensRef.current.length > 1) {
      rotateToken()
    }
  }, [rotateToken])

  const handleScan = async () => {
    if (!orgName.trim()) return

    setRepos([])
    setProgress({
      phase: 'fetching-repos',
      totalRepos: 0,
      fetchedRepos: 0,
      checkedRepos: 0,
      jfrogReposFound: 0,
      currentRepo: '',
      error: null,
      rateLimitRemaining: rateLimit?.remaining || 60,
      rateLimitReset: rateLimit?.reset || null
    })

    try {
      const allRepos = await fetchOrgRepos(
        orgName.trim(),
        getCurrentToken,
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
        totalRepos: allRepos.length
      }))

      const scanResult = await checkAllReposForJfrog(
        allRepos,
        getCurrentToken,
        (checked, current, jfrogFound) => {
          setProgress(prev => ({
            ...prev,
            checkedRepos: checked,
            currentRepo: current,
            jfrogReposFound: jfrogFound
          }))
        },
        handleRateLimit
      )

      setRepos(scanResult.repos)
      
      if (scanResult.isPartial) {
        setProgress(prev => ({
          ...prev,
          phase: 'partial',
          checkedRepos: scanResult.repos.length,
          jfrogReposFound: scanResult.repos.filter(r => r.hasJfrog).length,
          rateLimitReset: scanResult.rateLimitReset || null,
          error: `Rate limit exceeded. Only ${scanResult.repos.length} of ${allRepos.length} repositories were scanned.`
        }))
      } else {
        setProgress(prev => ({
          ...prev,
          phase: 'complete',
          checkedRepos: scanResult.repos.length,
          jfrogReposFound: scanResult.repos.filter(r => r.hasJfrog).length
        }))
      }
    } catch (error) {
      if (error instanceof RateLimitError) {
        setProgress(prev => ({
          ...prev,
          phase: 'partial',
          rateLimitReset: error.resetTime,
          error: `Rate limit exceeded during repo fetch. Resets at ${error.resetTime.toLocaleTimeString()}`
        }))
      } else {
        setProgress(prev => ({
          ...prev,
          phase: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }))
      }
    }
  }

  const handleExport = () => {
    const jfrogRepos = repos.filter(r => r.hasJfrog)
    const csv = generateCsv(jfrogRepos)
    downloadCsv(csv, `${orgName}-jfrog-repos-${new Date().toISOString().split('T')[0]}.csv`)
  }

  const jfrogRepos = repos.filter(r => r.hasJfrog)
  const isScanning = progress.phase === 'fetching-repos' || progress.phase === 'checking-lfs'
  const isFinished = progress.phase === 'complete' || progress.phase === 'partial'
  const scanProgress = progress.totalRepos > 0 
    ? Math.round((progress.checkedRepos / progress.totalRepos) * 100)
    : 0

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-primary/10 rounded-lg">
            <GithubLogo size={32} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">JFrog LFS Finder</h1>
            <p className="text-muted-foreground text-sm">Scan GitHub organizations for repos using JFrog LFS</p>
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
            <CardContent>
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
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
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
                        {i === currentTokenIndex % tokens.length && isScanning && (
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
                    ) : progress.phase === 'partial' ? (
                      <Warning size={18} className="text-yellow-500" />
                    ) : progress.phase === 'complete' ? (
                      <CheckCircle size={18} className="text-accent" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                    <span className="font-medium">
                      {progress.phase === 'fetching-repos' && 'Fetching repositories...'}
                      {progress.phase === 'checking-lfs' && `Checking for JFrog config: ${progress.currentRepo}`}
                      {progress.phase === 'complete' && 'Scan complete'}
                      {progress.phase === 'partial' && 'Scan stopped - Rate limit reached'}
                      {progress.phase === 'error' && 'Error'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    {progress.phase === 'checking-lfs' && (
                      <span>{progress.checkedRepos}/{progress.totalRepos} repos</span>
                    )}
                    {rateLimit && (
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {rateLimit.remaining}/{rateLimit.limit} requests
                      </span>
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
                  <Alert variant="destructive">
                    <AlertDescription>{progress.error}</AlertDescription>
                  </Alert>
                )}

                {progress.phase === 'partial' && (
                  <Alert className="border-yellow-500/50 bg-yellow-500/10">
                    <Warning size={16} className="text-yellow-500" />
                    <AlertDescription className="text-yellow-200">
                      {progress.error}
                      {progress.rateLimitReset && (
                        <span className="block mt-1 text-xs text-muted-foreground">
                          Rate limit resets at {progress.rateLimitReset.toLocaleTimeString()}
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {isFinished && (
                  <div className="flex items-center justify-between">
                    <div className="flex gap-4 text-sm">
                      <span>
                        <span className="text-muted-foreground">Repos scanned:</span>{' '}
                        <span className="font-semibold">{progress.checkedRepos}</span>
                        {progress.phase === 'partial' && (
                          <span className="text-muted-foreground"> of {progress.totalRepos}</span>
                        )}
                      </span>
                      <span>
                        <span className="text-muted-foreground">JFrog repos:</span>{' '}
                        <span className="font-semibold text-accent">{progress.jfrogReposFound}</span>
                      </span>
                    </div>
                    {jfrogRepos.length > 0 && (
                      <Button variant="secondary" size="sm" onClick={handleExport}>
                        <Download size={16} className="mr-2" />
                        Export {progress.phase === 'partial' ? 'Partial ' : ''}CSV
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isFinished && jfrogRepos.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle size={18} className="text-accent" />
                Repositories with JFrog LFS Config ({jfrogRepos.length})
                {progress.phase === 'partial' && (
                  <Badge variant="outline" className="ml-2 text-yellow-500 border-yellow-500/50">
                    Partial Results
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {jfrogRepos.map(repo => (
                    <div 
                      key={repo.id}
                      className="p-3 bg-secondary/30 rounded-lg border border-border/30 hover:border-border/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <a
                            href={repo.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline"
                          >
                            {repo.full_name}
                          </a>
                          {repo.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {repo.description}
                            </p>
                          )}
                          {repo.configLocations.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {repo.configLocations.map((location, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px] font-mono">
                                  {location}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {repo.jfrogUrls.slice(0, 3).map((url, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono">
                                {url.length > 40 ? url.slice(0, 40) + '...' : url}
                              </Badge>
                            ))}
                            {repo.jfrogUrls.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{repo.jfrogUrls.length - 3} more
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

        {isFinished && jfrogRepos.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <Database size={32} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No JFrog LFS repositories found</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Scanned {progress.checkedRepos} repositories in <span className="font-mono">{orgName}</span> but none had .lfsconfig files containing JFrog.
                {progress.phase === 'partial' && (
                  <span className="block mt-2 text-yellow-500">
                    Note: Only {progress.checkedRepos} of {progress.totalRepos} repositories were scanned due to rate limiting.
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default App
