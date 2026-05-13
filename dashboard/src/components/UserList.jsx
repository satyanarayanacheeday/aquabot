import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Search, User, MapPin, Fish } from 'lucide-react'

const UserList = ({ adminToken }) => {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('/api/dashboard/users', {
          headers: { 'x-admin-token': adminToken }
        })
        setUsers(res.data)
      } catch (err) {
        console.error('Failed to fetch users', err)
      } finally {
        setLoading(false)
      }
    }
    fetchUsers()
  }, [adminToken])

  const filteredUsers = users.filter(u => 
    (u.name?.toLowerCase().includes(search.toLowerCase()) || 
     u.phone.includes(search) ||
     u.village?.toLowerCase().includes(search.toLowerCase()))
  )

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading farmers...</div>

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Farmer Registry</h1>
        <div style={{ position: 'relative', width: '300px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input 
            type="text" 
            placeholder="Search by name, phone or village..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '0.75rem 0.75rem 0.75rem 2.5rem', 
              borderRadius: '12px', 
              border: '1px solid var(--glass-border)', 
              background: 'var(--bg-card)', 
              color: 'white',
              outline: 'none'
            }}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Farmer Name</th>
                <th>Phone Number</th>
                <th>Village</th>
                <th>Farm Type</th>
                <th>Ponds</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No farmers found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <User size={16} color="var(--accent-primary)" />
                        </div>
                        <span style={{ fontWeight: 500 }}>{u.name || 'Anonymous'}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.phone}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <MapPin size={14} color="var(--text-secondary)" />
                        {u.village || 'N/A'}
                      </div>
                    </td>
                    <td>
                      <span style={{ textTransform: 'capitalize' }}>{u.farm_type || 'Unknown'}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Fish size={14} color="var(--accent-secondary)" />
                        {u.pond_count}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${u.onboarding_complete ? 'status-green' : 'status-yellow'}`}>
                        {u.onboarding_complete ? 'Active' : 'Onboarding'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default UserList
