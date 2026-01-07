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
        getCurrentToken(),
        getCurrentToken(),
          setProgress(prev => ({
            fetchedRepos: fetchedRepos.length,
            totalRepos: fetchedRepos.length,
            currentRepo: `Page ${page}`
            totalRepos: fetchedRepos.length,
            currentRepo: `Page ${page}`
          }))
      )
        handleRateLimit
      )(prev => ({

        phase: 'checking-lfs',
        ...prev,Repos.length,
        phase: 'checking-lfs',
      }))

      const checkedRepos = await checkAllReposForLfs(
        allRepos,
        getCurrentToken(),
        (checked, current, lfsFound) => {
        getCurrentToken(),
            ...prev,
            checkedRepos: checked,
            ...prev,
            checkedRepos: checked,
          }))
            lfsReposFound: lfsFound
      )
        },
      setRepos(checkedRepos)
      setProgress(prev => ({

        phase: 'complete',
        lfsReposFound: checkedRepos.filter(r => r.hasLfs).length
        ...prev,
        phase: 'complete',
        checkedRepos: checkedRepos.length,
        lfsReposFound: checkedRepos.filter(r => r.hasLfs).length
        phase: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
        ...prev,
  }
        error: error instanceof Error ? error.message : 'Unknown error'
  const handleExport = () => {
    }
  }


  const lfsRepos = repos.filter(r => r.hasLfs)
    downloadCsv(csv, `${orgName}-lfs-repos-${new Date().toISOString().split('T')[0]}.csv`)
  }
? Math.round((progress.checkedRepos / progress.totalRepos) * 100)

  const isScanning = progress.phase === 'fetching-repos' || progress.phase === 'checking-lfs'
  const scanProgress = progress.totalRepos > 0 
      <div className="max-w-6xl mx-auto space-y-6">
    : 0lassName="flex items-center gap-3 mb-8">

  return ( className="text-primary" />
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
          <div>
        <header className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-primary/10 rounded-lg">
          </div>
        </header>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">LFS Repository Finder</h1>
            <p className="text-muted-foreground text-sm">Scan large GitHub organizations for Git LFS usage</p>
          </div>dHeader className="pb-3">
        </header>e flex items-center gap-2">

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="bg-card border-border">
            </CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MagnifyingGlass size={18} />
                <Input
                  id="org-name"
            </CardHeader>
                  value={orgName}
              <div className="flex gap-2">
                <Inputn={(e) => e.key === 'Enter' && !isScanning && handleScan()}
                  id="org-name"
                  placeholder="e.g. microsoft, google, facebook"
                />
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isScanning && handleScan()}
                  disabled={isScanning}
                  className="bg-input border-border font-mono"
                >
                <Button 
                    <span className="flex items-center gap-2">
                  disabled={!orgName.trim() || isScanning}
                  className="shrink-0"
                    </span>
                  {isScanning ? (
                    <span className="flex items-center gap-2">
                      Scan
                      <ArrowRight size={16} />
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Scan
            </CardContent>

                  )}
            <CardHeader className="pb-3">
              </div>enter justify-between">
            </CardContent>
                  <Database size={18} />
kens (Optional)
          <Card className="bg-card border-border">
            <CardHeader className="pb-3"> text-xs">
                  {tokens.length} token{tokens.length !== 1 ? 's' : ''}
                </Badge>
                  <Database size={18} />
                  PAT Tokens (Optional)
                </span>
                <Badge variant="secondary" className="font-mono text-xs">
                Add PAT tokens to increase rate limits (5000 req/hr vs 60). Multiple tokens enable rotation.
                </Badge>
              <div className="flex gap-2">
                  <Input
            <CardContent className="space-y-3">
                    type={showTokens ? 'text' : 'password'}
                Add PAT tokens to increase rate limits (5000 req/hr vs 60). Multiple tokens enable rotation.
                    value={newToken}
              <div className="flex gap-2">ue)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddToken()}
                  <Inputr-10"
                    id="new-token"
                  <button
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}ground"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddToken()}
                    className="bg-input border-border font-mono pr-10"
                  </button>
                <Button variant="secondary" size="icon" onClick={handleAddToken} disabled={!newToken.trim()}>
                    type="button"
                    onClick={() => setShowTokens(!showTokens)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showTokens ? <EyeSlash size={16} /> : <Eye size={16} />}
                  {tokens.map((token, i) => (
                </div>
                <Button variant="secondary" size="icon" onClick={handleAddToken} disabled={!newToken.trim()}>
                  <Plus size={16} />4)}
                </Button> isScanning && (
              </div>
                        )}
                <div className="space-y-1">
                      <button
                    <div key={i} className="flex items-center justify-between bg-secondary/50 rounded px-3 py-1.5 text-xs">
                      <span className="font-mono text-muted-foreground">
                        {token.slice(0, 8)}...{token.slice(-4)}
                        <X size={14} />
                      </button>
                    </div>
                      </span>
                      <button
                        onClick={() => handleRemoveToken(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X size={14} />

                    </div>
          <Card className="bg-card border-border">
                </div>
              )}
                <div className="flex items-center justify-between text-sm">
                    {progress.phase === 'error' ? (
                      <Warning size={18} className="text-destructive" />
                ) : progress.phase === 'complete' ? (
        {progress.phase !== 'idle' && (
                    ) : (
            <CardContent className="py-4">nimate-spin" />
              <div className="space-y-3">
                    <span className="font-medium">
                      {progress.phase === 'fetching-repos' && 'Fetching repositories...'}
                      {progress.phase === 'checking-lfs' && `Checking for LFS: ${progress.currentRepo}`}
                      <Warning size={18} className="text-destructive" />
                    ) : progress.phase === 'complete' ? (
                      <CheckCircle size={18} className="text-accent" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                    <span className="font-medium">
                      {progress.phase === 'fetching-repos' && 'Fetching repositories...'}
                      {progress.phase === 'checking-lfs' && `Checking for LFS: ${progress.currentRepo}`}
                      </span>
                    {progress.phase === 'checking-lfs' && (
                      <span>{progress.checkedRepos}/{progress.totalRepos} repos</span>
                  </div>
                  </div>
                    {rateLimit && (
                      <span className="flex items-center gap-1">
                        <Clock size={14} />ing-lfs') && (
                        {rateLimit.remaining}/{rateLimit.limit} requests
                    <div 
                      className="h-full bg-primary transition-all duration-300 ease-out"
                    />
                      <span>{progress.checkedRepos}/{progress.totalRepos} repos</span>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-scan" />
                  </div>
                </div>
                
                {(progress.phase === 'fetching-repos' || progress.phase === 'checking-lfs') && (
                  <div className="relative overflow-hidden rounded-full bg-secondary h-2">
                    <div 
                      className="h-full bg-primary transition-all duration-300 ease-out"
                      style={{ width: `${progress.phase === 'fetching-repos' ? 5 : scanProgress}%` }}
                )}
                    {progress.phase === 'fetching-repos' && (
                {progress.phase === 'complete' && (
                    )}
                    <div className="flex gap-4 text-sm">
                      <span>
<span className="text-muted-foreground">Total repos:</span>{' '}
                {progress.phase === 'error' && (
                      </span>
                    <AlertDescription>{progress.error}</AlertDescription>
                        <span className="text-muted-foreground">LFS repos:</span>{' '}
                )}ccent">{progress.lfsReposFound}</span>
                   </span>
                {progress.phase === 'complete' && (
                    {lfsRepos.length > 0 && (
                    <div className="flex gap-4 text-sm">
                      <span>
                        <span className="text-muted-foreground">Total repos:</span>{' '}
                        <span className="font-semibold">{progress.totalRepos}</span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">LFS repos:</span>{' '}
                        <span className="font-semibold text-accent">{progress.lfsReposFound}</span>
            </CardContent>
          </Card>
                    {lfsRepos.length > 0 && (

                        <Download size={16} className="mr-2" />
          <Card className="bg-card border-border">
                      </Button>
                    )}
                <CheckCircle size={18} className="text-accent" />
                Repositories using LFS ({lfsRepos.length})
              </CardTitle>
            </CardContent>
          </Card>Content>
                <div className="space-y-2">

                    <div 
                      key={repo.id}
            <CardHeader className="pb-3">30 transition-colors"
              <CardTitle className="text-base flex items-center gap-2">
                      <div className="flex items-start justify-between gap-4">
                Repositories using LFS ({lfsRepos.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
                            rel="noopener noreferrer"
                <div className="space-y-2">derline"
                          >
                    <div 
                      key={repo.id}
                          {repo.description && (
                    >
                              {repo.description}
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            href={repo.html_url}
                              <Badge key={i} variant="outline" className="text-[10px] font-mono">
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline"
                          >
                            {repo.lfsPatterns.length > 3 && (
                                +{repo.lfsPatterns.length - 3} more
                          {repo.description && (
                            )}
                              {repo.description}
                            </p>
                        <div className="text-right text-xs text-muted-foreground shrink-0">
                          <div className="flex flex-wrap gap-1 mt-2">
                          <div>{new Date(repo.pushed_at).toLocaleDateString()}</div>
                        </div>
                                {pattern.length > 40 ? pattern.slice(0, 40) + '...' : pattern}
                    </div>
                            ))}
                </div>
                              <Badge variant="outline" className="text-[10px]">
            </CardContent>
          </Card>
                            )}

        {progress.phase === 'complete' && lfsRepos.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
                <Database size={32} className="text-muted-foreground" />
                        </div>
              <h3 className="text-lg font-medium mb-2">No LFS repositories found</h3>
                    </div>
                Scanned {progress.totalRepos} repositories in <span className="font-mono">{orgName}</span> but none were using Git LFS.
                </div>
              </ScrollArea>
            </CardContent>
        )}
        )}
    </div>
        {progress.phase === 'complete' && lfsRepos.length === 0 && (
}
            <CardContent className="py-12 text-center">
export default App
                <Database size={32} className="text-muted-foreground" />              <p className="text-sm text-muted-foreground max-w-md mx-auto">