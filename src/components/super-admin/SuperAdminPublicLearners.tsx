import React, { useState, useEffect } from 'react';
import {
  GraduationCap, Plus, Search, Edit, Trash2, Save, X,
  CheckCircle, XCircle, Copy, Check, Calendar, CreditCard,
  UserPlus, Shield, BookOpen, RefreshCw
} from 'lucide-react';
import { PublicLearnerRecord } from '../../types';
import { copyToClipboard } from '../../utils/clipboard';

function generateId() {
  return 'pl-' + Math.random().toString(36).substr(2, 9);
}

function getExpiryDate(plan: 'Monthly' | 'Quarterly' | 'Annual', from: string): string {
  const d = new Date(from);
  if (plan === 'Monthly') d.setMonth(d.getMonth() + 1);
  else if (plan === 'Quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

const PLAN_COLORS = {
  Monthly: 'bg-blue-100 text-blue-700',
  Quarterly: 'bg-violet-100 text-violet-700',
  Annual: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS = {
  Active: 'bg-emerald-100 text-emerald-700',
  Expired: 'bg-red-100 text-red-700',
  Suspended: 'bg-slate-100 text-slate-600',
};

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  plan: 'Monthly' as 'Monthly' | 'Quarterly' | 'Annual',
  phone: '',
  paymentDate: new Date().toISOString().split('T')[0],
  notes: '',
};

export default function SuperAdminPublicLearners() {
  const [learners, setLearners] = useState<PublicLearnerRecord[]>([]);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sa_public_learners');
    if (saved) {
      const parsed = JSON.parse(saved);
      const filtered = Array.isArray(parsed) ? parsed.filter((learner: PublicLearnerRecord) => !String(learner.id).startsWith('pl-demo')) : [];
      if (filtered.length !== parsed.length) localStorage.setItem('sa_public_learners', JSON.stringify(filtered));
      setLearners(filtered);
    } else {
      localStorage.setItem('sa_public_learners', JSON.stringify([]));
      setLearners([]);
    }
  }, []);

  const persist = (updated: PublicLearnerRecord[]) => {
    setLearners(updated);
    localStorage.setItem('sa_public_learners', JSON.stringify(updated));
  };

  const checkAndUpdateExpiry = () => {
    const today = new Date().toISOString().split('T')[0];
    const updated = learners.map(l => {
      if (l.status === 'Active' && l.expiryDate < today) {
        return { ...l, status: 'Expired' as const };
      }
      return l;
    });
    persist(updated);
  };

  useEffect(() => {
    checkAndUpdateExpiry();
  }, []);

  const filtered = learners.filter(l => {
    const matchSearch =
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.email.toLowerCase().includes(search.toLowerCase());
    const matchPlan = planFilter === 'All' || l.plan === planFilter;
    const matchStatus = statusFilter === 'All' || l.status === statusFilter;
    return matchSearch && matchPlan && matchStatus;
  });

  const startAdd = () => {
    setForm(EMPTY_FORM);
    setIsAdding(true);
    setEditingId(null);
  };

  const startEdit = (learner: PublicLearnerRecord) => {
    setForm({
      name: learner.name,
      email: learner.email,
      password: learner.password,
      plan: learner.plan,
      phone: learner.phone || '',
      paymentDate: learner.paymentDate,
      notes: learner.notes || '',
    });
    setEditingId(learner.id);
    setIsAdding(false);
  };

  const handleSave = () => {
    if (!form.name || !form.email || !form.password) return;
    const expiryDate = getExpiryDate(form.plan, form.paymentDate);

    if (isAdding) {
      const newLearner: PublicLearnerRecord = {
        id: generateId(),
        name: form.name,
        email: form.email,
        password: form.password,
        plan: form.plan,
        status: 'Active',
        paymentDate: form.paymentDate,
        expiryDate,
        phone: form.phone,
        notes: form.notes,
      };
      persist([newLearner, ...learners]);
    } else if (editingId) {
      const updated = learners.map(l =>
        l.id === editingId
          ? { ...l, ...form, expiryDate, status: l.status }
          : l
      );
      persist(updated);
    }

    setIsAdding(false);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    persist(learners.filter(l => l.id !== id));
    setDeleteConfirmId(null);
  };

  const handleToggleStatus = (id: string) => {
    const updated = learners.map(l => {
      if (l.id !== id) return l;
      const newStatus = l.status === 'Active' ? 'Suspended' : 'Active';
      return { ...l, status: newStatus as PublicLearnerRecord['status'] };
    });
    persist(updated);
  };

  const copyCreds = async (learner: PublicLearnerRecord) => {
    const text = `Login ID: ${learner.email}\nPassword: ${learner.password}\nPortal: Public Learning Access`;
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedId(learner.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const stats = {
    total: learners.length,
    active: learners.filter(l => l.status === 'Active').length,
    expired: learners.filter(l => l.status === 'Expired').length,
    annual: learners.filter(l => l.plan === 'Annual').length,
  };

  return (
    <div className="space-y-6" id="super-admin-public-learners">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            Public Learner Subscriptions
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage paid public learning subscribers. Credentials are used to unlock premium content.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={checkAndUpdateExpiry}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync Expiry
          </button>
          <button
            onClick={startAdd}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Learner
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Subscribers', value: stats.total, icon: GraduationCap, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Active', value: stats.active, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Expired', value: stats.expired, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
          { label: 'Annual Plans', value: stats.annual, icon: CreditCard, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map(stat => (
          <div key={stat.label} className={`${stat.bg} rounded-xl p-4 border border-white shadow-sm`}>
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{stat.label}</p>
            </div>
            <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Add / Edit Form */}
      {(isAdding || editingId) && (
        <div className="bg-white rounded-2xl border-2 border-indigo-200 shadow-lg p-6 animate-fade-in">
          <div className="flex justify-between items-center mb-5">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              {isAdding ? <UserPlus className="w-4 h-4 text-indigo-600" /> : <Edit className="w-4 h-4 text-amber-500" />}
              {isAdding ? 'Register New Subscriber' : 'Edit Subscriber'}
            </h3>
            <button onClick={() => { setIsAdding(false); setEditingId(null); }}>
              <X className="w-5 h-5 text-slate-400 hover:text-slate-700" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Full Name *</label>
              <input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="e.g. Priya Nair"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Email / Login ID *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="learner@email.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Password *</label>
              <input
                type="text"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="min. 6 characters"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="+91 9876543210"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Subscription Plan *</label>
              <select
                value={form.plan}
                onChange={e => setForm(p => ({ ...p, plan: e.target.value as any }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
              >
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly (3 months)</option>
                <option value="Annual">Annual (12 months)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Payment Date *</label>
              <input
                type="date"
                value={form.paymentDate}
                onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="e.g. Paid via UPI, KPSC aspirant"
              />
            </div>
          </div>
          <div className="mt-5 flex gap-2 justify-end">
            <button
              onClick={() => { setIsAdding(false); setEditingId(null); }}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.name || !form.email || !form.password}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {isAdding ? 'Register & Activate' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <select
          value={planFilter}
          onChange={e => setPlanFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-white font-medium focus:outline-none"
        >
          <option value="All">All Plans</option>
          <option value="Monthly">Monthly</option>
          <option value="Quarterly">Quarterly</option>
          <option value="Annual">Annual</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-white font-medium focus:outline-none"
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Expired">Expired</option>
          <option value="Suspended">Suspended</option>
        </select>
      </div>

      {/* Learners Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No subscribers found</p>
            <p className="text-xs mt-1">Add a new learner to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-wider">Learner</th>
                  <th className="text-left py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-wider">Login ID</th>
                  <th className="text-left py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-wider">Plan</th>
                  <th className="text-left py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-wider">Expires</th>
                  <th className="text-right py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(learner => (
                  <tr key={learner.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-black text-sm shrink-0">
                          {learner.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-800 text-xs">{learner.name}</p>
                          {learner.phone && <p className="text-[10px] text-slate-400">{learner.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="text-xs font-mono text-slate-700">{learner.email}</p>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PLAN_COLORS[learner.plan]}`}>
                        {learner.plan}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[learner.status]}`}>
                        {learner.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Calendar className="w-3 h-3" />
                        {learner.expiryDate}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Copy credentials */}
                        <button
                          onClick={() => copyCreds(learner)}
                          className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500 transition-colors"
                          title="Copy credentials"
                        >
                          {copiedId === learner.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {/* Toggle Active / Suspended */}
                        <button
                          onClick={() => handleToggleStatus(learner.id)}
                          className={`p-1.5 rounded-lg transition-colors ${learner.status === 'Active' ? 'hover:bg-red-50 text-red-400' : 'hover:bg-emerald-50 text-emerald-500'}`}
                          title={learner.status === 'Active' ? 'Suspend' : 'Activate'}
                        >
                          {learner.status === 'Active' ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => startEdit(learner)}
                          className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-500 transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {/* Delete */}
                        {deleteConfirmId === learner.id ? (
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              onClick={() => handleDelete(learner.id)}
                              className="text-[10px] font-bold px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-[10px] font-bold px-2 py-1 bg-slate-200 text-slate-600 rounded-lg"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(learner.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-400 text-center">
        <Shield className="w-3 h-3 inline-block mr-1" />
        Credentials are stored securely in the ERP tenant store. Share via copy button.
      </p>
    </div>
  );
}
