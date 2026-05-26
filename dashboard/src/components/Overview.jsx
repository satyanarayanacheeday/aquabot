import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Users, Droplets, CheckCircle2, AlertCircle } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'

const Overview = ({ adminToken }) => {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('/api/dashboard/stats', {
          headers: { 'x-admin-token': adminToken }
        })
        setStats(res.data)
      } catch (err) {
        console.error('Failed to fetch stats', err)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [adminToken])

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>Loading statistics...</div>
  if (!stats) return <div style={{ color: 'var(--status-red)' }}>Error loading stats. Please check your connection.</div>

  const healthData = [
    { name: 'Healthy', value: stats.healthDistribution.green || 0, color: '#10b981' },
    { name: 'Warning', value: stats.healthDistribution.yellow || 0, color: '#f59e0b' },
    { name: 'Critical', value: stats.healthDistribution.red || 0, color: '#ef4444' }
  ].filter(d => d.value >= 0) // Keep 0 values for legend visibility if preferred, but usually filter > 0

  return (
    <div className="animate-fade-in">
      <h1 style={{ marginBottom: '2rem' }}>Operations Overview</h1>
      
      <div className="stats-grid">
        <div className="card kpi-card">
          <div className="kpi-label">Total Farmers</div>
          <div className="kpi-value">{stats.totalFarmers}</div>
          <Users size={20} color="var(--accent-primary)" />
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Onboarding Rate</div>
          <div className="kpi-value">{stats.onboardingRate}%</div>
          <CheckCircle2 size={20} color="var(--accent-secondary)" />
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Total Ponds</div>
          <div className="kpi-value">{stats.totalPonds}</div>
          <Droplets size={20} color="#3b82f6" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginTop: '2rem' }}>
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Droplets size={20} /> Pond Health Distribution
          </h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={healthData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {healthData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: 'white' }}
                />
                <Legend iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>Conversion Funnel</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '1rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span className="kpi-label">Registration</span>
                <span>{stats.totalFarmers}</span>
              </div>
              <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: '100%', background: 'var(--accent-primary)' }}></div>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span className="kpi-label">Onboarding Complete</span>
                <span>{stats.onboardingRate}%</span>
              </div>
              <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${stats.onboardingRate}%`, height: '100%', background: 'var(--accent-secondary)' }}></div>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>
              Farmers are successfully transitioning from Day 1 curiosity to full pond setup.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Overview
