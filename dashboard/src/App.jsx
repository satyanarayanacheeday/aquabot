import React, { useState, useEffect } from 'react'
import { LayoutDashboard, Users, MessageSquare, BarChart3, Search, LogOut } from 'lucide-react'
import Overview from './components/Overview'
import UserList from './components/UserList'
import ChatExplorer from './components/ChatExplorer'

function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken') || '')

  useEffect(() => {
    if (adminToken) {
      setIsAuthenticated(true)
    }
  }, [adminToken])

  const handleLogin = (e) => {
    e.preventDefault()
    const token = e.target.token.value
    localStorage.setItem('adminToken', token)
    setAdminToken(token)
    setIsAuthenticated(true)
  }

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    setAdminToken('')
    setIsAuthenticated(false)
  }

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div className="card animate-fade-in" style={{ width: '400px' }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>aquaIQ Admin</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input 
              type="password" 
              name="token" 
              placeholder="Admin Token" 
              required 
              style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
            />
            <button 
              type="submit" 
              style={{ padding: '0.75rem', borderRadius: '8px', border: 'none', background: 'var(--accent-primary)', color: 'white', fontWeight: '600', cursor: 'pointer' }}
            >
              Access Dashboard
            </button>
          </form>
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            Check your server's .env file for the secure DASHBOARD_ADMIN_TOKEN
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <BarChart3 size={32} />
          <span>aquaIQ</span>
        </div>
        
        <nav style={{ flex: 1 }}>
          <div 
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <LayoutDashboard size={20} />
            <span>Overview</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={20} />
            <span>Farmers</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setActiveTab('chats')}
          >
            <MessageSquare size={20} />
            <span>Chat Explorer</span>
          </div>
        </nav>

        <div className="nav-item" onClick={handleLogout} style={{ marginTop: 'auto', color: '#ef4444' }}>
          <LogOut size={20} />
          <span>Logout</span>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === 'overview' && <Overview adminToken={adminToken} />}
        {activeTab === 'users' && <UserList adminToken={adminToken} />}
        {activeTab === 'chats' && <ChatExplorer adminToken={adminToken} />}
      </main>
    </div>
  )
}

export default App
