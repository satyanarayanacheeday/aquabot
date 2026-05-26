import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { MessageCircle, User, Phone, Calendar } from 'lucide-react'

const ChatExplorer = ({ adminToken }) => {
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [chats, setChats] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingChats, setLoadingChats] = useState(false)

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
        setLoadingUsers(false)
      }
    }
    fetchUsers()
  }, [adminToken])

  useEffect(() => {
    if (selectedUserId) {
      const fetchChats = async () => {
        setLoadingChats(true)
        try {
          const res = await axios.get(`/api/dashboard/chats/${selectedUserId}`, {
            headers: { 'x-admin-token': adminToken }
          })
          setChats(res.data)
        } catch (err) {
          console.error('Failed to fetch chats', err)
        } finally {
          setLoadingChats(false)
        }
      }
      fetchChats()
    }
  }, [selectedUserId, adminToken])

  const selectedUser = users.find(u => u.id === selectedUserId)

  if (loadingUsers) return <div style={{ color: 'var(--text-secondary)' }}>Loading conversations...</div>

  return (
    <div className="animate-fade-in">
      <h1 style={{ marginBottom: '2rem' }}>Chat Explorer</h1>

      <div className="chat-explorer">
        {/* User Sidebar */}
        <div className="chat-list">
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            RECENT CONVERSATIONS
          </div>
          {users.map(u => (
            <div 
              key={u.id}
              onClick={() => setSelectedUserId(u.id)}
              style={{ 
                padding: '1rem', 
                cursor: 'pointer', 
                borderBottom: '1px solid var(--glass-border)',
                background: selectedUserId === u.id ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
                transition: 'background 0.2s'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: selectedUserId === u.id ? 'var(--accent-primary)' : 'white' }}>
                  {u.name || u.phone}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.village || 'No village info'}
              </div>
            </div>
          ))}
        </div>

        {/* Chat Window */}
        <div className="chat-window">
          {!selectedUserId ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '1rem' }}>
              <MessageCircle size={48} opacity={0.5} />
              <p>Select a farmer to view their chat history</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <User size={20} color="white" />
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{selectedUser?.name || 'Anonymous'}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Phone size={12} /> {selectedUser?.phone}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="chat-messages">
                {loadingChats ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading history...</div>
                ) : chats.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No messages found for this user.</div>
                ) : (
                  chats.map((msg, i) => (
                    <React.Fragment key={msg.id || i}>
                      {/* User Message */}
                      {msg.message && (
                        <div className="msg-bubble msg-received">
                          <div>{msg.message}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem', textAlign: 'right' }}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      )}
                      {/* Bot Response */}
                      {msg.response && (
                        <div className="msg-bubble msg-sent">
                          <div>{msg.response}</div>
                          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', marginTop: '0.5rem', textAlign: 'right' }}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatExplorer
