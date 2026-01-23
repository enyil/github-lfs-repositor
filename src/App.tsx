import { useState, useCallback, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  ArrowRight,
  ArrowsClockwise,
  UploadSimple,
  FloppyDisk,
  ArrowCounterClockwise,
  Pause,
  Globe
} from '@phosphor-icons/react'
import {
  Repository,
  ScanProgress,
  GitHubRateLimit,
  RateLimitError,
  NetworkError,
  AggregateRateLimit,
  ScanState,
  fetchOrgRepos,
  checkAllReposForJfrog,
  generateCsv,
  downloadCsv,
  downloadScanState,
  parseScanState,
  fetchTokenRateLimits,
  normalizeGhesHost
} from '@/lib/github'

function App() {
  const [orgName, setOrgName] = useState('')
  const [ghesHost, setGhesHost] = useState('')
  const [tokens, setTokens] = useState<string[]>([])
  const [newToken, setNewToken] = useState('')
  const [showTokens, setShowTokens] = useState(false)
  const [repos, setRepos] = useState<Repository[]>([])
  const [aggregateLimit, setAggregateLimit] = useState<AggregateRateLimit | null>(null)
  const [loadingLimits, setLoadingLimits] = useState(false)
  const [scanState, setScanState] = useState<ScanState | null>(null)
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
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(null)
  const [currentTokenIndex, setCurrentTokenIndex] = useState(0)
  const tokenIndexRef = useRef(0)
  const tokensRef = useRef<string[]>([])
  const ghesHostRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cancelScanRef = useRef(false)

  tokensRef.current = tokens
  ghesHostRef.current = ghesHost

  const refreshRateLimits = useCallback(async () => {
    if (tokens.length === 0) {
      setAggregateLimit(null)
      return
    }
    setLoadingLimits(true)
    try {
      const limits = await fetchTokenRateLimits(tokens, ghesHost)
      setAggregateLimit(limits)
    } finally {
      setLoadingLimits(false)
    }
  }, [tokens, ghesHost])

  useEffect(() => {
    refreshRateLimits()
  }, [refreshRateLimits])

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

  const getTokenCount = useCallback(() => {
    return tokensRef.current.length
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
  }, [])

  const handleRetry = useCallback((attempt: number, maxRetries: number, error: string) => {
    setRetryMessage(`Retry ${attempt}/${maxRetries}: ${error}`)
  }, [])

  const handleScan = async (resumeState?: ScanState) => {
    const targetOrg = resumeState?.orgName || orgName.trim()
    if (!targetOrg) return

    const targetGhesHost = normalizeGhesHost(resumeState?.ghesHost || ghesHost.trim())
    cancelScanRef.current = false

    if (resumeState) {
      setOrgName(resumeState.orgName)
      setGhesHost(resumeState.ghesHost || '')
    }

    setRepos(resumeState?.jfrogRepos || [])
    setRetryMessage(null)
    setProgress({
      phase: resumeState ? 'checking-lfs' : 'fetching-repos',
      totalRepos: resumeState?.allRepos.length || 0,
      fetchedRepos: resumeState?.allRepos.length || 0,
      checkedRepos: resumeState?.scannedRepoIds.length || 0,
      jfrogReposFound: resumeState?.jfrogRepos.length || 0,
      currentRepo: resumeState ? 'Resuming scan...' : '',
      error: null,
      rateLimitRemaining: rateLimit?.remaining || 60,
      rateLimitReset: rateLimit?.reset || null
    })

    let currentScanState: ScanState | null = resumeState || null

    try {
      const allRepos = resumeState?.allRepos || await fetchOrgRepos(
        targetOrg,
        getCurrentToken,
        (fetchedRepos, page) => {
          setProgress(prev => ({
            ...prev,
            fetchedRepos: fetchedRepos.length,
            totalRepos: fetchedRepos.length,
            currentRepo: `Page ${page}`
          }))
        },
        handleRateLimit,
        rotateToken,
        getTokenCount,
        undefined,
        handleRetry,
        targetGhesHost
      )

      if (!currentScanState) {
        currentScanState = {
          orgName: targetOrg,
          createdAt: new Date().toISOString(),
          allRepos,
          scannedRepoIds: [],
          pendingRepoIds: allRepos.map(r => r.id),
          jfrogRepos: [],
          isComplete: false,
          ghesHost: targetGhesHost
        }
      }

      setRetryMessage(null)
      setProgress(prev => ({
        ...prev,
        phase: 'checking-lfs',
        totalRepos: allRepos.length
      }))

      const scanResult = await checkAllReposForJfrog(
        allRepos,
        getCurrentToken,
        (checked, current, jfrogFound) => {
          setRetryMessage(null)
          setProgress(prev => ({
            ...prev,
            checkedRepos: checked,
            currentRepo: current,
            jfrogReposFound: jfrogFound
          }))
        },
        handleRateLimit,
        rotateToken,
        getTokenCount,
        currentScanState,
        handleRetry,
        () => cancelScanRef.current,
        targetGhesHost
      )

      setRepos(scanResult.repos)
      setScanState(scanResult.scanState)
      setRetryMessage(null)
      
      if (scanResult.isPartial) {
        if (!scanResult.wasPaused) {
          downloadScanState(scanResult.scanState)
        }
        
        setProgress(prev => ({
          ...prev,
          phase: 'partial',
          checkedRepos: scanResult.scanState.scannedRepoIds.length,
          jfrogReposFound: scanResult.repos.filter(r => r.hasJfrog).length,
          rateLimitReset: scanResult.rateLimitReset || null,
          error: scanResult.wasPaused 
            ? scanResult.errorMessage || 'Scan paused by user.'
            : scanResult.errorMessage || `Scan interrupted. ${scanResult.scanState.scannedRepoIds.length} of ${allRepos.length} repositories scanned. State file auto-downloaded for recovery.`
        }))
      } else {
        setProgress(prev => ({
          ...prev,
          phase: 'complete',
          checkedRepos: scanResult.scanState.scannedRepoIds.length,
          jfrogReposFound: scanResult.repos.filter(r => r.hasJfrog).length
        }))
      }
    } catch (error) {
      setRetryMessage(null)
      
      if (currentScanState) {
        currentScanState.lastError = error instanceof Error ? error.message : 'Unknown error'
        setScanState(currentScanState)
        downloadScanState(currentScanState)
      }
      
      if (error instanceof RateLimitError) {
        setProgress(prev => ({
          ...prev,
          phase: 'partial',
          rateLimitReset: error.resetTime,
          error: `Rate limit exceeded during repo fetch. Resets at ${error.resetTime.toLocaleTimeString()}. State file auto-downloaded.`
        }))
      } else if (error instanceof NetworkError) {
        setProgress(prev => ({
          ...prev,
          phase: 'partial',
          error: `Network error: ${error.message}. State file auto-downloaded for recovery.`
        }))
      } else {
        setProgress(prev => ({
          ...prev,
          phase: 'error',
          error: (error instanceof Error ? error.message : 'Unknown error') + (currentScanState ? ' State file auto-downloaded for recovery.' : '')
        }))
      }
    }
  }

  const handlePause = useCallback(() => {
    cancelScanRef.current = true
  }, [])

  const handleResume = () => {
    if (scanState && scanState.pendingRepoIds.length > 0) {
      handleScan(scanState)
    }
  }

  const handleExport = () => {
    const jfrogRepos = repos.filter(r => r.hasJfrog)
    const csv = generateCsv(jfrogRepos)
    const targetOrg = scanState?.orgName || orgName
    downloadCsv(csv, `${targetOrg}-jfrog-repos-${new Date().toISOString().split('T')[0]}.csv`)
  }

  const handleExportFromState = () => {
    if (scanState) {
      const csv = generateCsv(scanState.jfrogRepos)
      downloadCsv(csv, `${scanState.orgName}-jfrog-repos-${new Date().toISOString().split('T')[0]}.csv`)
    }
  }

  const handleExportState = () => {
    if (scanState) {
      downloadScanState(scanState)
    }
  }

  const handleImportState = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const state = parseScanState(content)
      
      if (state) {
        setScanState(state)
        setOrgName(state.orgName)
        setGhesHost(state.ghesHost || '')
        setRepos(state.jfrogRepos)
        setProgress({
          phase: state.isComplete ? 'complete' : 'partial',
          totalRepos: state.allRepos.length,
          fetchedRepos: state.allRepos.length,
          checkedRepos: state.scannedRepoIds.length,
          jfrogReposFound: state.jfrogRepos.length,
          currentRepo: '',
          error: state.isComplete ? null : `Loaded state: ${state.scannedRepoIds.length} scanned, ${state.pendingRepoIds.length} remaining`,
          rateLimitRemaining: 60,
          rateLimitReset: null
        })
      } else {
        setProgress(prev => ({
          ...prev,
          phase: 'error',
          error: 'Invalid scan state file format'
        }))
      }
    } catch (err) {
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: 'Failed to read scan state file'
      }))
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const jfrogRepos = repos.filter(r => r.hasJfrog)
  const isScanning = progress.phase === 'fetching-repos' || progress.phase === 'checking-lfs'
  const isFinished = progress.phase === 'complete' || progress.phase === 'partial'
  const canResume = scanState && scanState.pendingRepoIds.length > 0 && !isScanning
  const canExportFromState = scanState && scanState.jfrogRepos.length > 0 && !isScanning
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
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-muted-foreground shrink-0" />
                  <Input
                    id="ghes-host"
                    placeholder="github.com"
                    value={ghesHost}
                    onChange={(e) => setGhesHost(e.target.value)}
                    disabled={isScanning}
                    className="bg-input border-border font-mono text-sm flex-1"
                  />
                  {ghesHost.trim() && ghesHost.trim().toLowerCase() !== 'github.com' && (
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0 text-accent border-accent/50">
                      GHES
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground pl-6">
                  Leave blank for github.com, or enter your GHES hostname
                </p>
              </div>
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
                {isScanning ? (
                  <Button 
                    onClick={handlePause}
                    variant="destructive"
                    className="shrink-0"
                  >
                    <span className="flex items-center gap-2">
                      <Pause size={16} weight="fill" />
                      Pause
                    </span>
                  </Button>
                ) : (
                  <Button 
                    onClick={() => handleScan()}
                    disabled={!orgName.trim()}
                    className="shrink-0"
                  >
                    <span className="flex items-center gap-2">
                      Scan
                      <ArrowRight size={16} />
                    </span>
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImportState}
                  disabled={isScanning}
                  className="flex-1"
                >
                  <UploadSimple size={14} className="mr-1.5" />
                  Load State
                </Button>
                {canExportFromState && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportFromState}
                    className="flex-1"
                  >
                    <Download size={14} className="mr-1.5" />
                    Export CSV ({scanState.jfrogRepos.length})
                  </Button>
                )}
                {canResume && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleResume}
                    className="flex-1"
                  >
                    <ArrowCounterClockwise size={14} className="mr-1.5" />
                    Resume ({scanState.pendingRepoIds.length} left)
                  </Button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleFileSelect}
              />
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Database size={18} />
                  PAT Tokens (Optional)
                </span>
                <div className="flex items-center gap-2">
                  {aggregateLimit && tokens.length > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge 
                            variant="outline" 
                            className={`font-mono text-xs cursor-help ${
                              aggregateLimit.totalRemaining < 100 ? 'text-destructive border-destructive/50' :
                              aggregateLimit.totalRemaining < 500 ? 'text-yellow-500 border-yellow-500/50' :
                              'text-accent border-accent/50'
                            }`}
                          >
                            {aggregateLimit.totalRemaining.toLocaleString()} / {aggregateLimit.totalLimit.toLocaleString()} requests
                            {aggregateLimit.uniqueUsers < tokens.length && (
                              <span className="ml-1 text-muted-foreground">({aggregateLimit.uniqueUsers} user{aggregateLimit.uniqueUsers !== 1 ? 's' : ''})</span>
                            )}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-medium mb-2">Rate limits per token:</p>
                          {aggregateLimit.tokenLimits.map((tl, i) => (
                            <div key={i} className="flex justify-between gap-4 text-xs">
                              <span className="font-mono">
                                {tl.username ? `@${tl.username}` : tl.token.slice(0, 8) + '...'}
                              </span>
                              <span>{tl.remaining} / {tl.limit}</span>
                            </div>
                          ))}
                          {aggregateLimit.uniqueUsers < tokens.length && (
                            <p className="text-muted-foreground text-xs mt-2 pt-2 border-t border-border">
                              Some tokens share the same user - limits counted once per user.
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <Badge variant="secondary" className="font-mono text-xs">
                    {tokens.length} token{tokens.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
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
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">Added tokens:</span>
                    <button
                      onClick={refreshRateLimits}
                      disabled={loadingLimits}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowsClockwise size={12} className={loadingLimits ? 'animate-spin' : ''} />
                      Refresh limits
                    </button>
                  </div>
                  {tokens.map((token, i) => {
                    const tokenLimit = aggregateLimit?.tokenLimits.find(tl => tl.token === token)
                    const isDuplicateUser = tokenLimit?.userId && aggregateLimit?.tokenLimits.some(
                      (tl, idx) => idx !== i && tl.userId === tokenLimit.userId
                    )
                    return (
                      <div key={i} className="flex items-center justify-between bg-secondary/50 rounded px-3 py-1.5 text-xs">
                        <span className="font-mono text-muted-foreground flex items-center gap-2">
                          {tokenLimit?.username ? (
                            <span>@{tokenLimit.username}</span>
                          ) : (
                            <span>{token.slice(0, 8)}...{token.slice(-4)}</span>
                          )}
                          {i === currentTokenIndex % tokens.length && isScanning && (
                            <Badge variant="outline" className="text-[10px]">active</Badge>
                          )}
                          {isDuplicateUser && (
                            <Badge variant="outline" className="text-[10px] text-yellow-500 border-yellow-500/50">shared</Badge>
                          )}
                          {tokenLimit && (
                            <span className={`${
                              tokenLimit.remaining < 100 ? 'text-destructive' :
                              tokenLimit.remaining < 500 ? 'text-yellow-500' :
                              'text-accent'
                            }`}>
                              ({tokenLimit.remaining})
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => handleRemoveToken(i)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )
                  })}
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
                      {progress.phase === 'partial' && 'Scan stopped'}
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
                  <div className="space-y-2">
                    <div className="relative overflow-hidden rounded-full bg-secondary h-2">
                      <div 
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${progress.phase === 'fetching-repos' ? 5 : scanProgress}%` }}
                      />
                      {progress.phase === 'fetching-repos' && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-scan" />
                      )}
                    </div>
                    {retryMessage && (
                      <div className="flex items-center gap-2 text-xs text-yellow-500">
                        <ArrowsClockwise size={12} className="animate-spin" />
                        <span>{retryMessage}</span>
                      </div>
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
                      <span className="block mt-1 text-xs text-muted-foreground">
                        Scan state has been auto-saved. Use "Load State" to resume later.
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                {isFinished && (
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex gap-4 text-sm">
                      <span>
                        <span className="text-muted-foreground">Repos scanned:</span>{' '}
                        <span className="font-semibold">{progress.checkedRepos}</span>
                        {progress.phase === 'partial' && scanState && (
                          <span className="text-muted-foreground"> of {progress.totalRepos}</span>
                        )}
                      </span>
                      <span>
                        <span className="text-muted-foreground">JFrog repos:</span>{' '}
                        <span className="font-semibold text-accent">{progress.jfrogReposFound}</span>
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {scanState && (
                        <Button variant="outline" size="sm" onClick={handleExportState}>
                          <FloppyDisk size={16} className="mr-2" />
                          Save State
                        </Button>
                      )}
                      {jfrogRepos.length > 0 && (
                        <Button variant="secondary" size="sm" onClick={handleExport}>
                          <Download size={16} className="mr-2" />
                          Export {progress.phase === 'partial' ? 'Partial ' : ''}CSV
                        </Button>
                      )}
                    </div>
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
                    Note: Only {progress.checkedRepos} of {progress.totalRepos} repositories were scanned due to an error.
                  </span>
                )}
              </p>
              {scanState && progress.phase === 'partial' && (
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleExportState}>
                    <FloppyDisk size={16} className="mr-2" />
                    Save State for Later
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default App
