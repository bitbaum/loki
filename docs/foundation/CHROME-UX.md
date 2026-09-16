# Chrome UX (header, nav, sidebar)

## Problem
- Account/logout buried at bottom of left rail; no standard header-right account menu.  
- Minimized left panel: **horizontal scrolling** — Frankenstein.  
- Header/footer/nav less coherent than OrangeCat; Loki uses `@bitbaum/design-tokens` but shell composition is uneven (AppShell / AppTopBar / sidebar cluster).  
- Frankenstein control rows (uneven buttons thrown together) on Control/Feedback.

## Target
OrangeCat-class chrome without cloning OC branding:
1. **Top bar:** brand | primary nav (Control, Feedback, Terminal, AI, Robots, Projects…) | search/command | bell | **account menu** (avatar → profile, settings, logout).  
2. **Left rail:** icon nav only when collapsed — **no horizontal scroll**; tooltips; overflow = “More”.  
3. **Footer:** version/commit only if useful; don’t park account there.  
4. Shared tokens; one shell SSOT (`AppShell`); delete duplicate account entry points or make them aliases.  
5. Audit Feedback/Control action clusters → one primary, one secondary, overflow menu.

## Done when
Walk: desktop + narrow width; collapsed sidebar has zero horizontal overflow; logout from header avatar in ≤2 clicks; no account-only-at-bottom-of-rail. Screenshots in PR.
