import React, { useState, useEffect } from 'react';
import { FileText, School, DollarSign, TrendingUp, Users } from 'lucide-react';

interface SchoolRecord {
  id: string;
  name: string;
  code: string;
  city: string;
  status: 'Active' | 'Inactive';
  studentCount: number;
  revenueLakhs: number;
}

export default function SuperAdminReports() {
  const [schools, setSchools] = useState<SchoolRecord[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('sa_schools');
    if (saved) {
      const parsed = JSON.parse(saved);
      setSchools(Array.isArray(parsed) ? parsed.filter((school: SchoolRecord) => !['sch-1', 'sch-2', 'sch-3'].includes(school.id)) : []);
    } else {
      setSchools([]);
    }
  }, []);

  const totalEnrollment = schools.reduce((sum, s) => sum + s.studentCount, 0);
  const totalRev = schools.reduce((sum, s) => sum + s.revenueLakhs, 0);

  return (
    <div className="space-y-6 animate-fade-in" id="super-admin-consolidated-reports">
      {/* Title */}
      <div>
        <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">
          Consolidated Reports & Audits
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Global audit of tuition revenues, student counts, and real-time security container logs.</p>
      </div>

      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 flex items-center gap-2">
          <School className="w-4 h-4 text-indigo-500" />
          Branch Enrollment Breakdowns
        </h3>
        <p className="text-[10px] text-slate-400 mb-6">Visual comparison of rostered student metrics across registered campuses.</p>

        {/* Custom Bar Chart SVG */}
        <div className="h-48 flex items-end justify-between gap-6 pt-4 max-w-2xl relative">
          <div className="absolute inset-x-0 bottom-6 border-b border-dashed border-slate-100"></div>
          <div className="absolute inset-x-0 bottom-20 border-b border-dashed border-slate-100"></div>
          <div className="absolute inset-x-0 bottom-36 border-b border-dashed border-slate-100"></div>

          {schools.map(sch => {
            const maxVal = 1500;
            const heightPercent = (sch.studentCount / maxVal) * 100;
            return (
              <div key={sch.id} className="flex-1 flex flex-col items-center group relative z-10">
                <div className="text-[10px] font-bold text-slate-700 mb-2 font-mono">
                  {sch.studentCount} students
                </div>
                <div
                  className={`w-full max-w-[48px] rounded-t transition-all duration-500 ${
                    sch.status === 'Active' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300'
                  }`}
                  style={{ height: `${heightPercent}%`, minHeight: '15%' }}
                ></div>
                <span className="text-[10px] font-mono font-bold text-slate-500 mt-2 text-center line-clamp-1">{sch.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-4 flex items-center gap-1.5">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            Finance Collections (₹ In Lakhs)
          </h3>
          <div className="divide-y divide-slate-100">
            {schools.map(sch => (
              <div key={sch.id} className="py-3 flex justify-between items-center text-xs">
                <div>
                  <p className="font-bold text-slate-800">{sch.name}</p>
                  <p className="text-[10px] text-slate-400">Monthly target allocation ledger</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-slate-900">₹{sch.revenueLakhs} Lakhs</p>
                  <p className="text-[9px] text-emerald-600 font-bold uppercase mt-0.5">{sch.status === 'Active' ? 'Target Met' : 'Suspended'}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-3.5 mt-2 border-t border-slate-200 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-800 uppercase">Gross System Revenue</span>
            <span className="text-sm font-bold text-indigo-600 font-mono">₹{totalRev.toFixed(1)} Lakhs</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 border-b border-slate-50 pb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            Global ERP Security Audit
          </h3>
          
          <div className="space-y-3 font-mono text-[10px] text-slate-500">
            <div className="flex justify-between items-start">
              <span>[09:12 AM] JWT Signature verify complete</span>
              <span className="text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">VERIFIED</span>
            </div>
            <div className="flex justify-between items-start">
              <span>[09:15 AM] Delhi branch promotion state loaded</span>
              <span className="text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.2 rounded">READY</span>
            </div>
            <div className="flex justify-between items-start">
              <span>[09:22 AM] Mumbai backup replication task complete</span>
              <span className="text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">SUCCESS</span>
            </div>
            <div className="flex justify-between items-start text-slate-400">
              <span>[09:45 AM] Bangalore franchise is set to Inactive</span>
              <span className="text-amber-600 font-bold bg-amber-50 px-1.5 py-0.2 rounded">SUSPENDED</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
