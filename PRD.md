# GitHub LFS Repository Finder

A tool for discovering repositories that use Git LFS within large GitHub organizations (1000+ repos), with CSV export functionality.

**Experience Qualities**:
1. **Efficient** - Handles large organizations with thousands of repos through smart pagination and parallel requests
2. **Transparent** - Shows real-time progress and status during scanning operations
3. **Professional** - Clean, developer-focused interface that feels like a proper DevOps tool

**Complexity Level**: Light Application (multiple features with basic state)
- Multiple interconnected features: org search, repo scanning, LFS detection, CSV export
- Requires managing async operations, pagination, and progress state

## Essential Features

### 1. Organization Input & Validation
- **Functionality**: Accept GitHub organization name and optional PAT token(s)
- **Purpose**: Entry point for scanning - PAT increases rate limits from 60 to 5000 req/hr
- **Trigger**: User enters org name and clicks "Scan"
- **Progression**: Enter org name → Add PAT (optional) → Validate org exists → Begin scan
- **Success criteria**: Valid orgs proceed to scanning, invalid show clear error

### 2. Repository Scanner
- **Functionality**: Fetch all repos in org using REST API pagination (not Search API to avoid 1000 limit)
- **Purpose**: Build complete list of repos regardless of org size
- **Trigger**: After org validation
- **Progression**: Fetch page 1 → Continue pagination → Build repo list → Show count
- **Success criteria**: All repos fetched with progress indicator

### 3. LFS Detection
- **Functionality**: Check each repo's .gitattributes for LFS filter patterns
- **Purpose**: Identify which repos use Git LFS
- **Trigger**: After repo list is built
- **Progression**: Queue repos → Check .gitattributes → Parse for LFS patterns → Mark as LFS/non-LFS
- **Success criteria**: Accurate detection with progress shown

### 4. Results Display
- **Functionality**: Show filterable list of LFS repos with details
- **Purpose**: Let users review findings before export
- **Trigger**: After scan completes
- **Progression**: Display results → Filter/sort → Select for export
- **Success criteria**: Clear presentation of repo names, sizes, LFS status

### 5. CSV Export
- **Functionality**: Generate downloadable CSV of LFS repos
- **Purpose**: Enable reporting and further analysis
- **Trigger**: User clicks export button
- **Progression**: Generate CSV → Trigger download
- **Success criteria**: Valid CSV with repo details downloads successfully

## Edge Case Handling

- **Rate Limiting**: Display remaining requests, pause when near limit, support multiple PATs for rotation
- **Private Orgs**: Clear messaging when PAT lacks permissions
- **Empty Results**: Friendly state when no LFS repos found
- **Network Errors**: Retry logic with exponential backoff, clear error messages
- **Large Orgs**: Progress indicator, estimated time remaining

## Design Direction

Technical, professional, and trustworthy - like a well-designed CLI tool with a GUI. Dark theme suggests developer tooling. Clean data presentation prioritizes scannability.

## Color Selection

- **Primary Color**: `oklch(0.65 0.2 250)` - Electric blue for actions and focus states
- **Secondary Colors**: `oklch(0.25 0.02 250)` - Dark slate for cards/surfaces
- **Accent Color**: `oklch(0.75 0.15 150)` - Mint green for success/LFS indicators
- **Background**: `oklch(0.15 0.02 250)` - Deep navy-black
- **Foreground/Background Pairings**:
  - Background (Deep navy): White text `oklch(0.95 0 0)` - Ratio 12:1 ✓
  - Card (Dark slate): Light gray `oklch(0.85 0 0)` - Ratio 8:1 ✓
  - Primary (Electric blue): White text - Ratio 4.8:1 ✓

## Font Selection

Monospace-influenced typography reinforces the developer tooling aesthetic while maintaining readability for data-heavy displays.

- **Primary Font**: JetBrains Mono - For all UI text, reinforcing code/dev aesthetic
- **Typographic Hierarchy**:
  - H1 (Page Title): JetBrains Mono Bold/32px/tight
  - H2 (Section): JetBrains Mono SemiBold/20px/normal
  - Body: JetBrains Mono Regular/14px/relaxed
  - Data/Stats: JetBrains Mono Medium/16px/tight

## Animations

Subtle, functional animations that indicate progress and state changes without distraction. Loading states use pulsing effects. Scan progress uses smooth transitions.

## Component Selection

- **Components**: 
  - Input for org name and PAT tokens
  - Button for actions (scan, export)
  - Card for results container
  - Progress for scan status
  - Table for results display
  - Badge for status indicators
  - Alert for errors/warnings
- **Customizations**: Custom progress indicator showing repos scanned
- **States**: Buttons disabled during scan, inputs locked during operation
- **Icon Selection**: MagnifyingGlass (search), Download (export), CheckCircle (LFS), Warning (errors)
- **Spacing**: Generous padding (p-6 cards), tight data rows (py-2)
- **Mobile**: Stack inputs vertically, scrollable table, sticky export button
