import React, { useState } from 'react';
import { File, FolderOpen, Code, Database, Compass, Copy, Check, Server, ShieldCheck, Terminal, Layers } from 'lucide-react';
import { CODE_FILES, CodeFile } from '../data/codeBase';
import { copyToClipboard } from '../utils/clipboard';

export default function DeveloperPortal() {
  const [selectedFile, setSelectedFile] = useState<CodeFile>(CODE_FILES[0]);
  const [activeTab, setActiveTab] = useState<'code' | 'er' | 'architecture'>('code');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(selectedFile.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ER Diagram Table list
  const erTables = [
    {
      name: 'users',
      desc: 'Base Identity Table',
      fields: [
        { name: 'id', type: 'UUID', key: 'PK' },
        { name: 'email', type: 'VARCHAR(255)', key: 'UNIQUE' },
        { name: 'hashed_password', type: 'VARCHAR(255)' },
        { name: 'full_name', type: 'VARCHAR(150)' },
        { name: 'phone', type: 'VARCHAR(20)', key: 'UNIQUE' },
        { name: 'role', type: 'user_role (ENUM)' },
        { name: 'is_active', type: 'BOOLEAN' },
        { name: 'is_deleted', type: 'BOOLEAN', key: 'SOFT_DELETE' }
      ]
    },
    {
      name: 'students',
      desc: 'Student Profiles Directory',
      fields: [
        { name: 'id', type: 'UUID', key: 'PK' },
        { name: 'user_id', type: 'UUID', key: 'FK -> users(id)' },
        { name: 'parent_id', type: 'UUID', key: 'FK -> parents(id)' },
        { name: 'class_id', type: 'UUID', key: 'FK -> classes(id)' },
        { name: 'admission_no', type: 'VARCHAR(100)', key: 'UNIQUE' },
        { name: 'roll_no', type: 'INT' },
        { name: 'dob', type: 'DATE' },
        { name: 'gender', type: 'VARCHAR(10)' },
        { name: 'status', type: 'VARCHAR(20)', key: 'ACTIVE' }
      ]
    },
    {
      name: 'classes',
      desc: 'Syllabus Classes & Sections',
      fields: [
        { name: 'id', type: 'UUID', key: 'PK' },
        { name: 'school_id', type: 'UUID', key: 'FK' },
        { name: 'name', type: 'VARCHAR(50)', key: 'Admin-defined class' },
        { name: 'section', type: 'VARCHAR(10)' },
        { name: 'room_number', type: 'VARCHAR(20)' }
      ]
    },
    {
      name: 'attendance',
      desc: 'Daily Attendance Ledger',
      fields: [
        { name: 'id', type: 'UUID', key: 'PK' },
        { name: 'student_id', type: 'UUID', key: 'FK -> students(id)' },
        { name: 'class_id', type: 'UUID', key: 'FK -> classes(id)' },
        { name: 'date', type: 'DATE' },
        { name: 'status', type: 'VARCHAR(10)', key: 'PRESENT/ABSENT' }
      ]
    }
  ];

  return (
    <div className="space-y-6" id="developer-portal">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-base font-sans font-semibold text-slate-900">Developer Workspace & Code Hub</h2>
          <p className="text-xs text-slate-500">Explore complete PostgreSQL relational schemas, FastAPI microservices, and React Native code structures.</p>
        </div>

        {/* Deliverables selectors */}
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-lg self-start sm:self-center">
          <button
            onClick={() => setActiveTab('code')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${activeTab === 'code' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Source Code Files
          </button>
          <button
            onClick={() => setActiveTab('er')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${activeTab === 'er' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            ER Diagram Modeling
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${activeTab === 'architecture' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Architecture Guide
          </button>
        </div>
      </div>

      {activeTab === 'code' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left: Files outline tree */}
          <div className="bg-slate-900 text-slate-300 rounded-lg p-4 border border-slate-800 shadow-sm flex flex-col h-[560px]">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-3">
              <FolderOpen className="w-4 h-4 text-indigo-400" />
              <h3 className="font-sans font-semibold text-white text-xs uppercase tracking-wider">Source Tree Blueprint</h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {CODE_FILES.map((file) => (
                <div
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`p-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                    selectedFile.path === file.path ? 'bg-indigo-600 text-white font-bold' : 'hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <File className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{file.path}</span>
                  </div>
                  <span className="text-[9px] opacity-70 font-mono tracking-wide uppercase px-1.5 py-0.5 rounded bg-black/20">
                    {file.language}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Code Reader */}
          <div className="lg:col-span-3 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col h-[560px]">
            {/* Toolbar */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h4 className="text-xs font-bold text-slate-900">{selectedFile.path}</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">{selectedFile.description}</p>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied!' : 'Copy Code'}</span>
              </button>
            </div>

            {/* Code pane container */}
            <div className="flex-1 overflow-auto p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed relative">
              <pre className="whitespace-pre">{selectedFile.content}</pre>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'er' && (
        <div className="space-y-6">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex gap-3 items-start">
            <Database className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-xs text-indigo-900 leading-relaxed">
              <p className="font-bold text-indigo-950">Relational Relational Integrity Mapping</p>
              <p className="mt-0.5 text-indigo-800/95">Every entity is fully normalized with UUID Primary Keys, Audit logging, and Soft Delete indices tracking operations. Relationships conform to CASCADE/SET NULL constraints.</p>
            </div>
          </div>

          {/* Schema cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {erTables.map((table) => (
              <div key={table.name} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="bg-slate-900 text-white p-3">
                  <h4 className="text-xs font-bold font-mono">{table.name}</h4>
                  <p className="text-[9px] text-slate-400 mt-0.5 leading-snug">{table.desc}</p>
                </div>
                <div className="p-3 divide-y divide-slate-50">
                  {table.fields.map((f) => (
                    <div key={f.name} className="py-2 flex justify-between items-center text-[11px] font-mono">
                      <span className="text-slate-800 font-semibold">{f.name}</span>
                      <div className="text-right">
                        <p className="text-slate-500 font-medium">{f.type}</p>
                        {f.key && <span className="inline-block text-[8px] bg-indigo-50 text-indigo-600 px-1 rounded-sm mt-0.5 font-bold">{f.key}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'architecture' && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4 max-w-3xl mx-auto text-xs text-slate-600">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
            <Layers className="w-6 h-6 text-indigo-600" />
            <div>
              <h3 className="font-sans font-bold text-slate-900 text-sm">Enterprise System Architecture Diagram</h3>
              <p className="text-[11px] text-slate-500">School ERP & LMS Consolidated Core Design</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <Terminal className="w-5 h-5 text-indigo-600 mx-auto mb-2" />
                <h4 className="font-bold text-slate-900">React Native App</h4>
                <p className="text-[11px] text-slate-400 mt-1">Cross-platform UI with Redux Toolkit state, secure Keychain token storage, and WebSocket triggers.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <Server className="w-5 h-5 text-indigo-600 mx-auto mb-2" />
                <h4 className="font-bold text-slate-900">FastAPI Gateway</h4>
                <p className="text-[11px] text-slate-400 mt-1">REST API gateway supporting OAuth2 JWT validations, asynchronous task runner queues, and Razorpay endpoints.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <Database className="w-5 h-5 text-indigo-600 mx-auto mb-2" />
                <h4 className="font-bold text-slate-900">PostgreSQL Core</h4>
                <p className="text-[11px] text-slate-400 mt-1">Relational PostgreSQL database instance storing structured users registries, fees ledgers, and index registers.</p>
              </div>
            </div>

            <div className="bg-slate-50/50 p-4 rounded-lg border border-slate-200 space-y-3">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>Consolidated Security Protections</span>
              </h4>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li>**JWT Authentication**: Implements bearer OAuth2 token schemas with custom verification mechanisms.</li>
                <li>**Password Salting**: Incorporates bcrypt password hashing in db operations.</li>
                <li>**Role-Based Access Control (RBAC)**: Enforces API checks (Super Admin, Teacher, Student, Parent, Librarian).</li>
                <li>**Input validation checks**: Leverages FastAPI Pydantic schema validation bounds.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
