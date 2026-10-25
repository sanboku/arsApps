import { useEffect, useState } from 'react'
import { useDB } from './store'
import Login from './pages/Login'
import Home from './pages/Home'
import Schedule from './pages/Schedule'
import Drivers from './pages/Drivers'
import Clients from './pages/Clients'
import Billing from './pages/Billing'
import Vehicles from './pages/Vehicles'

const PAGES = {
  home: { label: 'トップ', C: Home },
  schedule: { label: '案件予定表', C: Schedule },
  drivers: { label: 'ドライバー', C: Drivers },
  clients: { label: '請求先', C: Clients },
  billing: { label: '請求・支払', C: Billing },
  vehicles: { label: '車両管理', C: Vehicles },
} as const
export type PageKey = keyof typeof PAGES

const currentPage = (): PageKey => {
  const h = location.hash.slice(1)
  return h in PAGES ? (h as PageKey) : 'home'
}

export default function App() {
  const store = useDB()
  const [user, setUser] = useState(() => sessionStorage.getItem('arsapps-user'))
  const [page, setPage] = useState<PageKey>(currentPage)

  useEffect(() => {
    const onHash = () => setPage(currentPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!user)
    return (
      <Login
        onLogin={(name) => {
          sessionStorage.setItem('arsapps-user', name)
          setUser(name)
        }}
      />
    )

  const { C } = PAGES[page]
  return (
    <div className="app">
      <header className="topbar">
        <a href="#home" className="brand">arsApps</a>
        <nav>
          {(Object.keys(PAGES) as PageKey[]).map((k) => (
            <a key={k} href={`#${k}`} className={k === page ? 'active' : ''}>
              {PAGES[k].label}
            </a>
          ))}
        </nav>
        <div className="user">
          {user}
          <button
            className="ghost"
            onClick={() => {
              sessionStorage.removeItem('arsapps-user')
              setUser(null)
            }}
          >
            ログアウト
          </button>
        </div>
      </header>
      <main>
        <C store={store} />
      </main>
    </div>
  )
}
