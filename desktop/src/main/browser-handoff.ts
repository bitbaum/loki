/**
 * Loki's browser window — fills a form on this computer and stops one click
 * short of done (src/config/browser-tasks.ts).
 *
 * The window keeps its own persistent session (`persist:loki-browser`), so the
 * operator signs in to a site once and stays signed in for the next hand-off.
 * It is a separate partition from the Loki app window on purpose: a third-party
 * site never sees Loki's cookies, and Loki's page never sees the site's.
 *
 * The filler runs in the page every POLL_MS until the form is ready. While the
 * site shows a sign-in page, it waits — that is the person's step, like the
 * final button. It never presses the hand-off button; the person does, and
 * any passkey prompt that follows is the site's and the OS's, unchanged.
 */
import { BrowserWindow, Notification } from 'electron'
import type { BrowserTask } from '@/config/browser-tasks'
import { browserFillScript, type BrowserFillResult } from '@/lib/browser-fill'

const PARTITION = 'persist:loki-browser'
const POLL_MS = 700
/** Long enough to sign in with a passkey and a slow second factor. */
const GIVE_UP_MS = 15 * 60_000

const open = new Map<string, BrowserWindow>()

export type BrowserHandoffOutcome =
  | { state: 'ready' }
  | { state: 'closed' }
  | { state: 'timeout'; missing: string[] }
  /** The filler itself failed to run — never retried for 15 minutes. */
  | { state: 'broken'; error: string }

/**
 * Open (or re-focus) the window for `task` and fill it. Resolves once the form
 * is ready, the operator closes the window, or it gives up. Callers should not
 * await it on the command loop: a person signing in takes minutes.
 */
export function openBrowserHandoff(task: BrowserTask): Promise<BrowserHandoffOutcome> {
  const existing = open.get(task.url)
  if (existing && !existing.isDestroyed()) existing.close()

  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    title: `Loki · ${task.title}`,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  open.set(task.url, win)
  // The site's own <title> would replace ours; the operator should always see
  // that this window is Loki's and what it is for.
  win.on('page-title-updated', (e) => e.preventDefault())
  // Links that open a new window (docs, "learn more") go to a child window in
  // the same signed-in session rather than the default browser.
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } },
  }))

  return new Promise((resolve) => {
    let settled = false
    let missing: string[] = []
    const started = Date.now()

    const finish = (outcome: BrowserHandoffOutcome) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      resolve(outcome)
    }

    const tick = async () => {
      if (settled || win.isDestroyed()) return
      if (Date.now() - started > GIVE_UP_MS) return finish({ state: 'timeout', missing })
      try {
        const result = (await win.webContents.executeJavaScript(browserFillScript(task), true)) as BrowserFillResult
        if (result.state === 'ready') {
          win.show()
          win.focus()
          if (Notification.isSupported()) {
            new Notification({ title: 'Loki filled the form', body: task.handoff.say }).show()
          }
          finish({ state: 'ready' })
        } else if (result.state === 'waiting') {
          missing = result.missing
        }
      } catch (e) {
        const message = (e as Error)?.message ?? String(e)
        // A script that cannot even run is a bug, not a slow page: say so at
        // once instead of retrying silently until the give-up.
        if (/ReferenceError|SyntaxError|is not defined/.test(message)) {
          if (Notification.isSupported()) {
            new Notification({
              title: "Loki couldn't fill this form",
              body: `The page is open — fill it by hand this time. (${message.slice(0, 120)})`,
            }).show()
          }
          return finish({ state: 'broken', error: message })
        }
        // Otherwise mid-navigation: the page has no document to run in; the
        // next tick lands on the new one.
      }
    }

    const timer = setInterval(() => void tick(), POLL_MS)
    win.on('closed', () => {
      open.delete(task.url)
      finish({ state: 'closed' })
    })
    void win.loadURL(task.url).catch(() => {
      // A failed first load still leaves the window for the operator to retry;
      // the poll keeps going and fills once the page is there.
    })
  })
}
