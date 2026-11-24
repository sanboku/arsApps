// 自動更新つき開発サーバー（npm run auto）
// - アプリ（Vite）を起動し、ブラウザを開く
// - 一定間隔で GitHub を確認し、新しい修正があれば取り込む（git pull --ff-only）
// - 画面のファイルが変わるとブラウザは自動で再読み込みされる（Vite の機能）
// - package.json / package-lock.json が変わったときは npm install してから再起動する
// Windows / Mac / Linux 共通で動くよう Node.js だけで書いている。
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const INTERVAL_SEC = Number(process.env.AUTO_UPDATE_INTERVAL ?? 30)
const VITE = join('node_modules', 'vite', 'bin', 'vite.js')

const time = () => new Date().toLocaleTimeString('ja-JP')
const log = (msg) => console.log(`\x1b[36m[自動更新 ${time()}]\x1b[0m ${msg}`)
const warn = (msg) => console.log(`\x1b[33m[自動更新 ${time()}]\x1b[0m ${msg}`)
const git = (args) => execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

let vite = null
let firstStart = true
function startVite() {
  if (!existsSync(VITE)) {
    log('部品をインストールしています（npm install）…')
    execSync('npm install', { stdio: 'inherit' })
  }
  // 初回だけブラウザを開く。node で直接起動すると、再起動時に確実に止められる
  vite = spawn(process.execPath, [VITE, ...(firstStart ? ['--open'] : [])], { stdio: 'inherit' })
  firstStart = false
}
function stopVite() {
  return new Promise((resolve) => {
    if (!vite || vite.exitCode !== null) return resolve()
    vite.once('exit', resolve)
    vite.kill()
  })
}

/** 取り込み先（このブランチの追跡先。なければ origin/ブランチ名） */
function upstream() {
  try {
    return git('rev-parse --abbrev-ref --symbolic-full-name @{u}')
  } catch {
    return `origin/${git('rev-parse --abbrev-ref HEAD')}`
  }
}

let warned = ''
const warnOnce = (key, msg) => {
  if (warned !== key) warn(msg)
  warned = key
}

let busy = false
async function check() {
  if (busy) return
  busy = true
  try {
    git('fetch --quiet')
    const up = upstream()
    const head = git('rev-parse HEAD')
    const remote = git(`rev-parse ${up}`)
    if (head === remote) return
    // 手元で編集したファイルがあると取り込めない（上書きしない）
    if (git('status --porcelain --untracked-files=no')) {
      return warnOnce(`dirty:${remote}`, '新しい修正がありますが、手元で変更されたファイルがあるため取り込めません。\n  変更が不要なら、別のターミナルで「git restore .」を実行してください（次の確認で自動的に取り込みます）。')
    }
    try {
      git(`merge-base --is-ancestor HEAD ${up}`)
    } catch {
      return warnOnce(`diverged:${remote}`, `手元の履歴と GitHub の履歴が分かれているため、自動では取り込めません（${up}）。`)
    }
    const changed = git(`diff --name-only HEAD ${up}`).split('\n')
    git('pull --ff-only --quiet')
    warned = ''
    log(`最新版を取り込みました：${git('log -1 --format=%s')}`)
    if (changed.some((f) => f === 'package.json' || f === 'package-lock.json')) {
      log('使う部品が変わったので、インストールしてアプリを再起動します…')
      await stopVite()
      execSync('npm install', { stdio: 'inherit' })
      startVite()
    }
    log('ブラウザの画面は自動で更新されます（変わらない場合は Ctrl+Shift+R で再読み込み）。')
  } catch (e) {
    warnOnce(`error:${e.message}`, `更新の確認に失敗しました（ネットワークを確認してください）：${String(e.stderr || e.message).trim().split('\n')[0]}`)
  } finally {
    busy = false
  }
}

const shutdown = async () => {
  await stopVite()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

log(`起動します。${INTERVAL_SEC}秒ごとに GitHub の最新版を確認します（止めるときは Ctrl+C）。`)
await check()
startVite()
setInterval(check, INTERVAL_SEC * 1000)
