import { useState } from 'react'

/**
 * サンプル用の簡易ログイン（ID: admin / PW: password）。
 * 本番では Supabase Auth 等に置き換え、パスワードはサーバー側で検証する。
 */
export default function Login({ onLogin }: { onLogin: (name: string) => void }) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  return (
    <div className="login">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (id === 'admin' && pw === 'password') onLogin('事務所 管理者')
          else setErr('IDまたはパスワードが違います')
        }}
      >
        <h1>arsApps</h1>
        <p className="muted">社内ポータル（サンプル版）</p>
        <label>ログインID<input value={id} onChange={(e) => setId(e.target.value)} autoFocus /></label>
        <label>パスワード<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <p className="error">{err}</p>}
        <button type="submit">ログイン</button>
        <p className="muted small">サンプル: admin / password</p>
      </form>
    </div>
  )
}
